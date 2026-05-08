const express = require('express')
const path = require('path')
const multiparty = require('multiparty')
const fse = require('fs-extra')
const cors = require('cors')
const bodyParser = require('body-parser')

const app = express()
const port = 3000

app.use(cors())
app.use(bodyParser.json())

const UPLOAD_DIR = path.resolve(__dirname, 'uploads')

// 提取文件后缀名
const extractExt = fileName => fileName.slice(fileName.lastIndexOf('.'), fileName.length)

app.post('/upload', function (req, res) {
  const form = new multiparty.Form()
  form.parse(req, async function (err, fields, files) {
    if (err) {
      console.error(err)
      res.status(401).json({
        ok: false,
        msg: '上传失败，请重新上传'
      })
      return
    }
    // console.log(fields)
    // console.log(files)
    const fileHash = fields.fileHash[0]
    const chunkHash = fields.chunkHashs[0]
    // 临时存放目录
    const chunkPath = path.resolve(UPLOAD_DIR, fileHash)
    if (!fse.existsSync(chunkPath)) {
      await fse.mkdir(chunkPath)
    }
    const oldPath = files.chunk[0].path
    const newPath = path.resolve(chunkPath, chunkHash)
    // 将切片放到这个文件夹里面
    await fse.move(oldPath, newPath)
    res.status(200).json({
      ok: true,
      msg: '上传成功'
    })
  })
})

app.post('/merge', async function (req, res) {
  const { fileHash, fileName, size } = req.body
  // 合并分片
  // console.log('fileHash:', fileHash)
  // console.log('fileName:', fileName)
  // console.log('size:', size)
  // 如果已经存在该文件，就没必要合并了
  // 完整的文件路径名
  const filePath = path.resolve(UPLOAD_DIR, fileHash + extractExt(fileName))
  if (fse.existsSync(filePath)) {
    res.status(200).json({
      ok: true,
      msg: '合并成功'
    })
    return
  }
  // 如果不存在该文件，才去合并
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash)
  if (!fse.existsSync(chunkDir)) {
    res.status(401).json({
      ok: false,
      msg: '合并失败，请重新上传'
    })
    return
  }
  const chunkPaths = await fse.readdir(chunkDir)
  console.log(chunkPaths)
  chunkPaths.sort((a, b) => a.split('-')[1] - b.split('-')[1])
  const list = chunkPaths.map(async (chunkName, index) => {
    return new Promise(resolve => {
      const chunkPath = path.resolve(chunkDir, chunkName)
      const readStream = fse.createReadStream(chunkPath)
      const writeStream = fse.createWriteStream(filePath, {
        start: index * size,
        end: (index + 1) * size
      })
      readStream.on('end', async () => {
        await fse.unlink(chunkPath)
        resolve()
      })
      readStream.pipe(writeStream)
    })
  })
  await Promise.all(list)
  await fse.remove(chunkDir)

  // 合并完成
  console.log('合并完成')
  res.status(200).json({
    ok: true,
    msg: '合并成功'
  })
})

app.post('/verify', async function (req, res) {
  const { fileHash, fileName } = req.body
  // 校验hash值
  // console.log('fileHash:', fileHash)
  // console.log('fileName:', fileName)
  // 校验hash值
  const filePath = path.resolve(UPLOAD_DIR, fileHash + extractExt(fileName))
  // 返回服务器已经上传成功的切片
  const chunkDir = path.join(UPLOAD_DIR, fileHash)
  let chunkPaths = []
  // 如果存在该文件夹，才去读取文件夹里面的文件
  if (fse.existsSync(chunkDir)) {
    chunkPaths = await fse.readdir(chunkDir)
    console.log(chunkPaths)
  }

  if (fse.existsSync(filePath)) {
    res.status(200).json({
      ok: true,
      data: {
        shouldUpload: false
      }
    })
  } else {
    res.status(200).json({
      ok: true,
      msg: '校验成功',
      data: {
        shouldUpload: true,
        existChunks: chunkPaths
      }
    })
  }
})



app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
