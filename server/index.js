const express = require('express')
const path = require('path')
const multiparty = require('multiparty')
const fse = require('fs-extra')
const cors = require('cors')
const bodyParser = require('body-parser')
const crypto = require('crypto')

const app = express()
const port = 3000

app.use(cors())
app.use(bodyParser.json())

const UPLOAD_DIR = path.resolve(__dirname, 'uploads')

const extractExt = fileName => fileName.slice(fileName.lastIndexOf('.'), fileName.length)

const getUploadedRanges = async chunkDir => {
  if (!fse.existsSync(chunkDir)) {
    return []
  }

  const chunkPaths = await fse.readdir(chunkDir)
  const indexes = chunkPaths
    .map(chunkName => Number(chunkName.split('-').pop()))
    .filter(index => Number.isInteger(index))
    .sort((a, b) => a - b)

  if (!indexes.length) {
    return []
  }

  const ranges = []
  let start = indexes[0]
  let end = indexes[0]

  for (let i = 1; i < indexes.length; i++) {
    const current = indexes[i]
    if (current === end + 1) {
      end = current
    } else if (current !== end) {
      ranges.push([start, end])
      start = current
      end = current
    }
  }

  ranges.push([start, end])
  return ranges
}

const calculateFileMD5 = filePath => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const readStream = fse.createReadStream(filePath)

    readStream.on('data', chunk => hash.update(chunk))
    readStream.on('end', () => resolve(hash.digest('hex')))
    readStream.on('error', reject)
  })
}

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

    const fileHash = fields.fileHash[0]
    const chunkHash = fields.chunkHashs[0]
    const chunkPath = path.resolve(UPLOAD_DIR, fileHash)

    if (!fse.existsSync(chunkPath)) {
      await fse.mkdirp(chunkPath)
    }

    const oldPath = files.chunk[0].path
    const newPath = path.resolve(chunkPath, chunkHash)
    await fse.move(oldPath, newPath, { overwrite: true })
    res.status(200).json({
      ok: true,
      msg: '上传成功'
    })
  })
})

app.post('/merge', async function (req, res) {
  try {
    const { fileHash, fileName, size, fileMD5 } = req.body
    const filePath = path.resolve(UPLOAD_DIR, fileHash + extractExt(fileName))
    const chunkDir = path.resolve(UPLOAD_DIR, fileHash)

    if (!fileMD5) {
      res.status(400).json({
        ok: false,
        msg: '缺少完整文件 MD5'
      })
      return
    }

    if (fse.existsSync(filePath)) {
      const serverMD5 = await calculateFileMD5(filePath)
      if (serverMD5 === fileMD5) {
        if (fse.existsSync(chunkDir)) {
          await fse.remove(chunkDir)
        }
        res.status(200).json({
          ok: true,
          msg: '合并成功',
          data: {
            fileMD5: serverMD5
          }
        })
        return
      }
      await fse.remove(filePath)
    }

    if (!fse.existsSync(chunkDir)) {
      res.status(401).json({
        ok: false,
        msg: '合并失败，请重新上传'
      })
      return
    }

    const chunkPaths = await fse.readdir(chunkDir)
    chunkPaths.sort((a, b) => a.split('-').pop() - b.split('-').pop())

    const list = chunkPaths.map((chunkName, index) => {
      return new Promise((resolve, reject) => {
        const chunkPath = path.resolve(chunkDir, chunkName)
        const readStream = fse.createReadStream(chunkPath)
        const writeStream = fse.createWriteStream(filePath, {
          start: index * size
        })

        readStream.on('error', reject)
        writeStream.on('error', reject)
        writeStream.on('finish', resolve)
        readStream.pipe(writeStream)
      })
    })

    await Promise.all(list)

    const serverMD5 = await calculateFileMD5(filePath)
    if (serverMD5 !== fileMD5) {
      await fse.remove(filePath)
      res.status(409).json({
        ok: false,
        msg: '文件校验失败，请重新上传',
        data: {
          clientMD5: fileMD5,
          serverMD5
        }
      })
      return
    }

    await fse.remove(chunkDir)

    res.status(200).json({
      ok: true,
      msg: '合并成功',
      data: {
        fileMD5: serverMD5
      }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      ok: false,
      msg: '合并失败，请重新上传'
    })
  }
})

app.post('/verify', async function (req, res) {
  const { fileHash, fileName, fileMD5 } = req.body
  const filePath = path.resolve(UPLOAD_DIR, fileHash + extractExt(fileName))
  const chunkDir = path.join(UPLOAD_DIR, fileHash)

  if (fse.existsSync(filePath)) {
    if (!fileMD5) {
      res.status(200).json({
        ok: true,
        data: {
          shouldUpload: false,
          uploadedRanges: []
        }
      })
      return
    }

    const serverMD5 = await calculateFileMD5(filePath)
    res.status(200).json({
      ok: true,
      data: {
        shouldUpload: serverMD5 !== fileMD5,
        uploadedRanges: [],
        fileMD5: serverMD5
      }
    })
    return
  }

  const uploadedRanges = await getUploadedRanges(chunkDir)
  res.status(200).json({
    ok: true,
    msg: '校验成功',
    data: {
      shouldUpload: true,
      uploadedRanges
    }
  })
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
