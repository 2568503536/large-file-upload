# large-file-upload

一个基于 Vue 3、Vite、Express 的大文件分片上传示例项目，演示了前端切片、文件 hash 计算、秒传校验、断点续传、并发上传以及服务端分片合并等核心流程。

## 功能特性

- 大文件切片：前端按照固定大小将文件拆分为多个分片
- 文件 hash：使用 `spark-md5` 计算文件 hash，作为文件唯一标识
- 秒传校验：上传前请求服务端判断完整文件是否已经存在
- 断点续传：服务端返回已上传分片，前端只上传缺失分片
- 并发上传：前端限制并发数量，批量上传文件分片
- 分片合并：服务端按照分片序号将分片写入完整文件
- 临时目录清理：合并完成后删除分片临时目录

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
   - hash 计算
   - 上传前校验
   - 缺失分片上传
   - 通知服务端合并
6. 合并后的完整文件会保存在：

```txt
server/uploads/
```

## 接口说明

### POST `/verify`

上传前校验接口，用于判断文件是否已经完整上传，以及返回已存在的分片列表。

请求体：

```json
{
  "fileHash": "文件hash",
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
    "existChunks": []
  }
}
```

如果完整文件已经存在：

```json
{
  "ok": true,
  "data": {
    "shouldUpload": false
  }
}
```

### POST `/upload`

分片上传接口，接收 `multipart/form-data` 类型数据。

表单字段：

| 字段 | 说明 |
| --- | --- |
| `fileHash` | 文件 hash |
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
  "fileHash": "文件hash",
  "fileName": "文件名",
  "size": 1048576
}
```

合并完成后，完整文件会保存为：

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
计算文件 hash
  ↓
请求 /verify 校验文件状态
  ↓
过滤服务端已存在的分片
  ↓
并发请求 /upload 上传缺失分片
  ↓
所有分片上传完成后请求 /merge
  ↓
服务端按分片序号合并文件
  ↓
删除临时分片目录，保留完整文件
```

## 关键文件

- 前端上传逻辑：[client/src/App.vue](client/src/App.vue)
- hash worker 示例：[client/src/hash.worker.js](client/src/hash.worker.js)
- 后端接口逻辑：[server/index.js](server/index.js)

## 常见问题

### 为什么合并完成后 `uploads` 文件夹还存在？

这是正常现象。项目只会删除 `server/uploads/{fileHash}/` 这个临时分片目录，不会删除 `server/uploads/` 根目录，因为合并后的完整文件会保存在 `server/uploads/` 下。

### 为什么上传同一个文件会直接提示已存在？

因为服务端会根据文件 hash 和文件后缀判断完整文件是否已经存在。如果存在，`/verify` 会返回 `shouldUpload: false`，前端就不会重复上传。

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
