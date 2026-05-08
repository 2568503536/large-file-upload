import SparkMD5 from 'spark-md5'

let stopped = false

self.onmessage = async event => {
  const { type, file, chunkSize } = event.data

  if (type === 'stop') {
    stopped = true
    return
  }

  if (type !== 'calculate') {
    return
  }

  stopped = false
  const totalChunks = Math.ceil(file.size / chunkSize)
  const spark = new SparkMD5.ArrayBuffer()

  for (let index = 0; index < totalChunks; index++) {
    if (stopped) {
      self.postMessage({ type: 'stopped' })
      return
    }

    const start = index * chunkSize
    const end = Math.min(file.size, start + chunkSize)
    const buffer = await file.slice(start, end).arrayBuffer()

    spark.append(buffer)

    self.postMessage({
      type: 'progress',
      progress: Math.round(((index + 1) / totalChunks) * 100)
    })
  }

  self.postMessage({
    type: 'complete',
    hash: spark.end()
  })
}
