<script setup>
import { ref } from 'vue'
import SparkMD5 from 'spark-md5'

const fileHash = ref('')
const fileName = ref('')
const CHUNK_SIZE = 1024 * 1024 // 1MB

const createChunks = file => {
  const chunks = []
  for (let i = 0; i < file.size; i += CHUNK_SIZE) {
    const end = i + CHUNK_SIZE
    const chunk = file.slice(i, end)
    chunks.push(chunk)
  }
  return chunks
}

const calculateHash = chunks => {
  return new Promise(resolve => {
    // 1. 第一个和最后一个切片全部参与计算
    // 2.中间的切片只计算前面两个字节、中间两个字节、后面两个字节
    const targets = [] // 存储所有参与计算的切片
    const spark = new SparkMD5.ArrayBuffer()
    const fileReader = new FileReader()
  
    chunks.forEach((chunk, index) => {
      if (index === 0 || index === chunks.length - 1) {
        targets.push(chunk)
      } else {
        const start = chunk.slice(0, 2)
        const middle = chunk.slice(CHUNK_SIZE / 2, CHUNK_SIZE / 2 + 2)
        const end = chunk.slice(CHUNK_SIZE - 2, CHUNK_SIZE)
        targets.push(start, middle, end)
      }
    })
  
    fileReader.readAsArrayBuffer(new Blob(targets))
    fileReader.onload = e => {
      spark.append(e.target.result)
      // console.log('hash: ' + spark.end())
      resolve(spark.end())
    }
  })
}

const mergeRequest = () => {
  fetch('http://localhost:3000/merge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value,
      size: CHUNK_SIZE
    })
  }).then(res => {
    console.log('合并请求结果:', res)
  })
}

// 上传分片
const uploadChunks = async (chunks, existingChunks) => {
  const data = chunks.map((chunk, index) => {
    return {
      fileHash: fileHash.value,
      chunkHashs: fileHash.value + '-' + index,
      chunk
    }
  })
  const formDatas = data
    .filter(item => !existingChunks.includes(item.chunkHashs))
    .map((item) => {
      const formData = new FormData()
      formData.append('fileHash', item.fileHash)
      formData.append('chunkHashs', item.chunkHashs)
      formData.append('chunk', item.chunk)
      return formData 
    })
  const max = 6
  let index = 0
  const taskPool = [] // 请求池
  while(index < formDatas.length) {
    const task = fetch('http://localhost:3000/upload', {
      method: 'POST',
      body: formDatas[index]
    })
    taskPool.splice(taskPool.findIndex(item => item === task), 1)
    taskPool.push(task)
    if (taskPool.length >= max) {
      await Promise.race(taskPool)
    }
    index++
  }
  await Promise.all(taskPool)
  // console.log('所有分片上传完成')
  // 通知服务器去合并分片
  mergeRequest()
  // 合并完成
  console.log('合并完成')
}

const verify = () => {
  return fetch('http://localhost:3000/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value,
    })
  }).then(res => res.json())
  .then(data => {
    return data
  })
}

const handleFileChange = async (e) => {
  const files = e.target.files
  if (files.length === 0) {
    return
  }
  // 读取文件
  fileName.value = files[0].name
  // 文件分片
  const chunks = createChunks(files[0])
  // hash计算
  const hash = await calculateHash(chunks)
  fileHash.value = hash
  // 校验hash值
  const res = await verify()
  if (!res.data.shouldUpload) {
    console.log('文件已存在')
    return
  }
  // 上传分片
  await uploadChunks(chunks, res.data.existChunks)
}
</script>

<template>
  <div>
    <h1>大文件上传</h1>
    <input type="file" @change="handleFileChange" />
  </div>
</template>
