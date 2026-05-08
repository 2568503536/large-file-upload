# large-file-upload

一个基于 Vue 3、Vite、Express 的大文件分片上传示例项目，演示了前端切片、文件 hash 计算、秒传校验、断点续传、并发上传以及服务端分片合并等核心流程。

## 功能特性

- 大文件切片：前端按照固定大小将文件拆分为多个分片
- 快速文件指纹：使用文件大小、前 2 个分片、最后 1 个分片生成上传标识，避免一开始计算全文件 MD5
- 后台完整 MD5：上传同时通过 Web Worker 异步计算完整文件 MD5，不阻塞主线程和上传流程
- 秒传校验：上传前请求服务端判断完整文件是否已经存在
- 区间式断点续传：服务端返回已上传分片区间，而不是返回完整分片列表
- 区间匹配过滤：前端通过区间匹配算法快速过滤待上传分片
- 可控并发上传：前端限制并发数量，批量上传剩余分片
- 上传控制：支持暂停、继续、终止，以及断网恢复后的自动续传
- 分片合并：服务端按照分片序号将分片写入完整文件
- 完整性校验：服务端合并后自行计算文件 MD5，并和前端完整 MD5 比对
- 临时目录清理：合并且校验通过后删除分片临时目录

## 技术栈

### 前端

- Vue 3
- Vite
- SparkMD5

### 后端

- Node.js
- Express
- multiparty
- fs-extra
- cors
- body-parser

## 项目结构

```txt
large-file-upload/
├── client/                 # 前端项目
│   ├── public/
│   ├── src/
│   │   ├── App.vue         # 上传核心逻辑和页面入口
│   │   ├── hash.worker.js  # Web Worker hash 计算示例
│   │   ├── main.js
│   │   └── style.css
│   ├── package.json
│   └── vite.config.js
├── server/                 # 后端项目
│   ├── index.js            # 上传、校验、合并接口
│   └── package.json
├── .nvmrc                  # Node 版本
└── README.md
```

## 环境要求

项目根目录提供了 `.nvmrc`，推荐使用：

```bash
node v22.16.0
```

如果你使用 nvm，可以在项目根目录执行：

```bash
nvm use
```

## 安装依赖

前端和后端是两个独立项目，需要分别安装依赖。

```bash
cd client
npm install
```

```bash
cd ../server
npm install
```

## 启动项目

### 1. 启动后端服务

```bash
cd server
node index.js
```

后端默认运行在：

```txt
http://localhost:3000
```

### 2. 启动前端服务

另开一个终端执行：

```bash
cd client
npm run dev
```

前端启动后，根据终端提示打开对应地址，通常是：

```txt
http://localhost:5173
```

## 使用方式

1. 启动后端服务
2. 启动前端服务
3. 在浏览器打开前端页面
4. 点击文件选择框选择一个文件
5. 前端会自动完成：
   - 文件切片
   - 快速文件指纹生成
   - 后台异步计算完整 MD5
   - 上传前校验
   - 获取已上传分片区间
   - 区间匹配过滤缺失分片
   - 可控并发上传剩余分片
   - 通知服务端合并并提交完整 MD5
   - 服务端合并后进行完整性校验
6. 合并后的完整文件会保存在：

```txt
server/uploads/
```

## 接口说明

### POST `/verify`

上传前校验接口，用于判断文件是否已经完整上传，以及返回已上传分片区间。

请求体：

```json
{
  "fileHash": "快速文件指纹",
  "fileName": "文件名"
}
```

返回示例：

```json
{
  "ok": true,
  "msg": "校验成功",
  "data": {
    "shouldUpload": true,
    "uploadedRanges": [[0, 10], [13, 20]]
  }
}
```

如果完整文件已经存在：

```json
{
  "ok": true,
  "data": {
    "shouldUpload": false,
    "uploadedRanges": []
  }
}
```

### POST `/upload`

分片上传接口，接收 `multipart/form-data` 类型数据。

表单字段：

| 字段 | 说明 |
| --- | --- |
| `fileHash` | 快速文件指纹 |
| `chunkHashs` | 分片名称，格式为 `fileHash-index` |
| `chunk` | 分片二进制内容 |

上传后的分片会临时保存到：

```txt
server/uploads/{fileHash}/
```

### POST `/merge`

分片合并接口，用于通知服务端将已上传分片合并为完整文件。

请求体：

```json
{
  "fileHash": "快速文件指纹",
  "fileName": "文件名",
  "size": 1048576,
  "fileMD5": "完整文件MD5"
}
```

合并完成后，服务端会重新计算合并文件的 MD5，并与前端传入的 `fileMD5` 比对。只有两者一致时才认为上传成功。

```txt
server/uploads/{fileHash}{文件后缀}
```

同时会删除临时分片目录：

```txt
server/uploads/{fileHash}/
```

## 核心流程

```txt
选择文件
  ↓
前端按 1MB 进行文件切片
  ↓
使用 文件大小 + 前 2 片 + 最后 1 片 生成快速文件指纹
  ↓
Web Worker 后台异步计算完整文件 MD5
  ↓
请求 /verify 校验文件状态，服务端返回已上传分片区间
  ↓
前端通过区间匹配算法过滤待上传分片
  ↓
可控并发请求 /upload 上传剩余分片
  ↓
上传过程中可暂停、继续、终止，断网恢复后自动续传
  ↓
所有分片上传完成后，等待完整 MD5 计算完成
  ↓
请求 /merge，提交快速文件指纹、文件名、分片大小和完整 MD5
  ↓
服务端按分片序号合并文件
  ↓
服务端计算合并后文件 MD5，并和前端完整 MD5 比对
  ↓
一致则删除临时分片目录并返回上传成功，不一致则删除损坏文件并提示重传
```

## 关键文件

- 前端上传逻辑：[client/src/App.vue](client/src/App.vue)
- hash worker 示例：[client/src/hash.worker.js](client/src/hash.worker.js)
- 后端接口逻辑：[server/index.js](server/index.js)

## 常见问题

### 为什么合并完成后 `uploads` 文件夹还存在？

这是正常现象。项目只会删除 `server/uploads/{fileHash}/` 这个临时分片目录，不会删除 `server/uploads/` 根目录，因为合并后的完整文件会保存在 `server/uploads/` 下。

### 为什么上传同一个文件会直接提示已存在？

因为服务端会根据快速文件指纹和文件后缀判断完整文件是否已经存在。如果存在，`/verify` 会返回 `shouldUpload: false`，前端就不会重复上传。

### 为什么不一开始计算完整文件 MD5？

超大文件完整 MD5 计算耗时较长，如果在上传前同步等待，会阻塞上传流程。当前方案先用文件大小、前 2 个分片、最后 1 个分片生成快速文件指纹用于服务端校验和断点续传，同时用 Web Worker 在后台异步计算完整 MD5。

### 为什么 `/verify` 返回分片区间，而不是分片列表？

当分片数量非常大时，返回完整分片列表会增加接口响应体积，也会让前端进行大量 `includes` 对比。区间格式例如 `[[0, 10], [13, 20]]`，可以用更少的数据表达连续分片，并通过区间匹配快速判断某个分片是否已上传。

### 分片大小在哪里设置？

前端在 `client/src/App.vue` 中通过 `CHUNK_SIZE` 设置，当前大小为：

```js
const CHUNK_SIZE = 1024 * 1024
```

也就是 1MB。

## 可用脚本

### 前端

```bash
npm run dev
npm run build
npm run preview
```

### 后端

当前后端没有配置启动脚本，可以直接执行：

```bash
node index.js
```

## 构建前端

```bash
cd client
npm run build
```

构建产物会生成到 `client/dist/` 目录。
