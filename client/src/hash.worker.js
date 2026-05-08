import SparkMD5 from 'spark-md5'

self.onmessage = async event => {
  console.log('收到消息:', event)
  const { file, chunkSize } = event.data
  const totalChunks = Math.ceil(file.size / chunkSize)
  const spark = new SparkMD5.ArrayBuffer()

  for (let index = 0; index < totalChunks; index++) {
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
