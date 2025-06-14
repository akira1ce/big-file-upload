# Next.js 大文件上传演示

一个使用分块上传、断点续传和文件去重功能的 Next.js 大文件上传演示项目。

## 功能特点

- 基于分块的文件上传
- 可断点续传（暂停/继续）
- 客户端文件哈希计算用于去重
- 文件状态跟踪
- 上传进度可视化
- 并发上传控制

## 技术实现

### 核心解决方案

1. **分块上传**：文件被分割成 2MB 的块并单独上传
2. **文件哈希计算**：
   - 使用 SparkMD5 为每个文件生成唯一哈希值
   - 在较小的 256KB 块中计算哈希，使用 requestIdleCallback 确保 UI 响应性
3. **文件去重**：
   - 上传前服务器基于哈希值检查文件是否已存在
   - 检测到重复文件时实现"秒传"
4. **断点续传能力**：
   - 在服务器上跟踪已上传的分块
   - 中断后可从最后一个成功的分块继续上传
5. **并发控制**：
   - 限制同时上传的文件数量为 3 个
   - 使用 AbortController 实现取消功能

## 开始使用

### 前提条件

- Node.js 16+ 和 npm/yarn

### 安装

```bash
# 安装依赖
npm install
# 或
yarn install
```

### 运行开发服务器

```bash
# 启动开发服务器
npm run dev
# 或
yarn dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000) 查看应用。

## 文件存储

上传的文件存储在项目根目录的 `/file/complete` 目录下。
