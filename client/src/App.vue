<script setup>
import { onBeforeUnmount, ref } from 'vue'
import SparkMD5 from 'spark-md5'

const fileHash = ref('')
const fileMD5 = ref('')
const fileName = ref('')
const uploadStatus = ref('请选择文件')
const uploadProgress = ref(0)
const hashProgress = ref(0)
const isUploading = ref(false)
const isPaused = ref(false)
const canResume = ref(false)

const CHUNK_SIZE = 1024 * 1024
const MAX_REQUEST = 6

let currentFile = null
let currentChunks = []
let pendingChunks = []
let worker = null
let fullMD5Promise = null
let fullMD5Resolve = null
let fullMD5Reject = null
let activeControllers = []
let shouldStop = false

const createChunks = file => {
  const chunks = []
  for (let index = 0, start = 0; start < file.size; index++, start += CHUNK_SIZE) {
    const end = Math.min(file.size, start + CHUNK_SIZE)
    chunks.push({
      index,
      start,
      end,
      chunk: file.slice(start, end)
    })
  }
  return chunks
}

const calculateFingerprint = async (file, chunks) => {
  const spark = new SparkMD5.ArrayBuffer()
  const targets = [String(file.size)]
  const firstChunk = chunks[0]
  const secondChunk = chunks[1]
  const lastChunk = chunks[chunks.length - 1]

  if (firstChunk) {
    targets.push(await firstChunk.chunk.arrayBuffer())
  }

  if (secondChunk && secondChunk.index !== lastChunk.index) {
    targets.push(await secondChunk.chunk.arrayBuffer())
  }

  if (lastChunk && lastChunk.index !== firstChunk.index && lastChunk.index !== secondChunk?.index) {
    targets.push(await lastChunk.chunk.arrayBuffer())
  }

  spark.append(await new Blob(targets).arrayBuffer())
  return spark.end()
}

const isChunkUploaded = (index, ranges) => {
  let left = 0
  let right = ranges.length - 1

  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const [start, end] = ranges[middle]

    if (index < start) {
      right = middle - 1
    } else if (index > end) {
      left = middle + 1
    } else {
      return true
    }
  }

  return false
}

const getPendingChunks = (chunks, ranges) => chunks.filter(item => !isChunkUploaded(item.index, ranges))

const resetWorker = () => {
  if (worker) {
    worker.postMessage({ type: 'stop' })
    worker.terminate()
    worker = null
  }
}

const calculateFullMD5 = file => {
  resetWorker()
  hashProgress.value = 0
  fileMD5.value = ''
  fullMD5Promise = new Promise((resolve, reject) => {
    fullMD5Resolve = resolve
    fullMD5Reject = reject
  })

  worker = new Worker(new URL('./hash.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = event => {
    const { type, progress, hash } = event.data

    if (type === 'progress') {
      hashProgress.value = progress
      return
    }

    if (type === 'complete') {
      fileMD5.value = hash
      fullMD5Resolve(hash)
      resetWorker()
    }
  }
  worker.onerror = error => {
    fullMD5Reject(error)
    resetWorker()
  }
  worker.postMessage({
    type: 'calculate',
    file,
    chunkSize: CHUNK_SIZE
  })

  return fullMD5Promise
}

const verify = () => {
  return fetch('http://localhost:3000/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value
    })
  }).then(res => res.json())
}

const mergeRequest = async () => {
  uploadStatus.value = '等待完整 MD5 计算完成...'
  const md5 = fileMD5.value || await fullMD5Promise
  uploadStatus.value = '正在通知服务端合并...'

  const res = await fetch('http://localhost:3000/merge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value,
      size: CHUNK_SIZE,
      fileMD5: md5
    })
  }).then(res => res.json())

  if (!res.ok) {
    throw new Error(res.msg)
  }

  uploadStatus.value = '上传成功，文件完整性校验通过'
}

const uploadChunk = async item => {
  const formData = new FormData()
  const controller = new AbortController()

  activeControllers.push(controller)
  formData.append('fileHash', fileHash.value)
  formData.append('chunkHashs', `${fileHash.value}-${item.index}`)
  formData.append('chunk', item.chunk)

  try {
    const res = await fetch('http://localhost:3000/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    }).then(res => res.json())

    if (!res.ok) {
      throw new Error(res.msg)
    }
  } finally {
    activeControllers = activeControllers.filter(current => current !== controller)
  }
}

const uploadChunks = async chunks => {
  let cursor = 0
  let finished = currentChunks.length - chunks.length
  let networkPaused = false

  uploadProgress.value = Math.round((finished / currentChunks.length) * 100)

  const runTask = async () => {
    while (cursor < chunks.length && !shouldStop && !isPaused.value) {
      if (!navigator.onLine) {
        networkPaused = true
        isPaused.value = true
        canResume.value = true
        uploadStatus.value = '网络已断开，等待恢复后自动续传'
        return
      }

      const chunk = chunks[cursor]
      cursor++
      await uploadChunk(chunk)
      finished++
      uploadProgress.value = Math.round((finished / currentChunks.length) * 100)
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_REQUEST, chunks.length) }, runTask))

  if (networkPaused || isPaused.value || shouldStop) {
    pendingChunks = chunks.slice(cursor)
    return false
  }

  return true
}

const startUpload = async file => {
  shouldStop = false
  isPaused.value = false
  canResume.value = false
  isUploading.value = true
  uploadProgress.value = 0
  uploadStatus.value = '正在生成文件指纹...'

  currentFile = file
  fileName.value = file.name
  currentChunks = createChunks(file)
  fileHash.value = await calculateFingerprint(file, currentChunks)
  uploadStatus.value = '文件指纹已生成，正在后台计算完整 MD5...'
  calculateFullMD5(file)

  const res = await verify()
  if (!res.data.shouldUpload) {
    uploadStatus.value = '文件已存在，无需重复上传'
    uploadProgress.value = 100
    isUploading.value = false
    return
  }

  pendingChunks = getPendingChunks(currentChunks, res.data.uploadedRanges || [])
  uploadStatus.value = `开始上传，待上传分片 ${pendingChunks.length} 个`

  const completed = await uploadChunks(pendingChunks)
  if (!completed) {
    return
  }

  await mergeRequest()
  isUploading.value = false
  canResume.value = false
}

const resumeUpload = async () => {
  if (!currentFile) {
    return
  }

  shouldStop = false
  isPaused.value = false
  canResume.value = false
  isUploading.value = true
  uploadStatus.value = '正在校验已上传分片区间...'

  const res = await verify()
  pendingChunks = getPendingChunks(currentChunks, res.data.uploadedRanges || [])
  uploadStatus.value = `继续上传，待上传分片 ${pendingChunks.length} 个`

  const completed = await uploadChunks(pendingChunks)
  if (!completed) {
    return
  }

  await mergeRequest()
  isUploading.value = false
}

const pauseUpload = () => {
  shouldStop = true
  isPaused.value = true
  canResume.value = true
  activeControllers.forEach(controller => controller.abort())
  activeControllers = []
  uploadStatus.value = '已暂停，可继续上传'
}

const stopUpload = () => {
  shouldStop = true
  isPaused.value = false
  canResume.value = false
  isUploading.value = false
  activeControllers.forEach(controller => controller.abort())
  activeControllers = []
  resetWorker()
  currentFile = null
  currentChunks = []
  pendingChunks = []
  uploadProgress.value = 0
  hashProgress.value = 0
  fileHash.value = ''
  fileMD5.value = ''
  fileName.value = ''
  uploadStatus.value = '已终止上传，请重新选择文件'
}

const handleFileChange = async e => {
  const files = e.target.files
  if (files.length === 0) {
    return
  }

  try {
    await startUpload(files[0])
  } catch (err) {
    if (shouldStop || isPaused.value) {
      return
    }
    uploadStatus.value = err.message || '上传失败，请重新上传'
    isUploading.value = false
    canResume.value = true
  }
}

window.addEventListener('online', () => {
  if (canResume.value && currentFile) {
    resumeUpload()
  }
})

window.addEventListener('offline', () => {
  if (isUploading.value) {
    pauseUpload()
    uploadStatus.value = '网络已断开，恢复后将自动续传'
  }
})

onBeforeUnmount(() => {
  resetWorker()
  activeControllers.forEach(controller => controller.abort())
})
</script>

<template>
  <div>
    <h1>大文件上传</h1>
    <input type="file" @change="handleFileChange" />
    <div>
      <button :disabled="!isUploading" @click="pauseUpload">暂停</button>
      <button :disabled="!canResume" @click="resumeUpload">继续</button>
      <button :disabled="!isUploading && !canResume" @click="stopUpload">终止</button>
    </div>
    <p>状态：{{ uploadStatus }}</p>
    <p>文件名：{{ fileName || '-' }}</p>
    <p>文件指纹：{{ fileHash || '-' }}</p>
    <p>上传进度：{{ uploadProgress }}%</p>
    <p>完整 MD5 计算进度：{{ hashProgress }}%</p>
    <p>完整 MD5：{{ fileMD5 || '-' }}</p>
  </div>
</template>
