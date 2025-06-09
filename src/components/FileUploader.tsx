'use client';

import { useState, useRef, ChangeEvent } from 'react';
import SparkMD5 from 'spark-md5';
import { Progress } from './ui/progress';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { toast, Toaster } from 'sonner';

interface UploadProgress {
  percentage: number;
  uploadedChunks: number;
  totalChunks: number;
  status: 'idle' | 'uploading' | 'paused' | 'completed' | 'error';
  message: string;
}

interface UploadFile {
  raw: File;
  hash: string | null;
  url: string | null;
  progress: UploadProgress;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const useFileUploader = () => {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const hashCache = useRef<Map<string, string>>(new Map());

  /* 分片大小 */
  const CHUNK_SIZE = 2 * 1024 * 1024;
  /* 哈希分片大小 */
  const HASH_CHUNK_SIZE = 256 * 1024;

  /* 添加文件 */
  const addFiles = (selectedFiles: FileList) => {
    const newFiles = Array.from(selectedFiles).map((file) => ({
      raw: file,
      hash: null,
      url: null,
      progress: {
        percentage: 0,
        uploadedChunks: 0,
        totalChunks: 0,
        status: 'idle' as const,
        message: '文件已选择，点击上传开始',
      },
    }));

    /* 检查文件是否已存在 */
    const existingFilesNames = files.map((file) => file.raw.name);

    /* 过滤掉已存在的文件 */
    const _files: UploadFile[] = [];

    newFiles.map((item) => {
      if (existingFilesNames.includes(item.raw.name)) {
        console.log('file already exists', item.raw.name);
        return;
      }
      _files.push(item);
    });

    setFiles((prev) => [...prev, ..._files]);
  };

  /* 更新文件进度 */
  const updateFileProgress = (fileId: string, progress: Partial<UploadProgress>) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.raw.name === fileId ? { ...file, progress: { ...file.progress, ...progress } } : file,
      ),
    );
  };

  /* 计算文件哈希值 */
  const calculateHash = async (file: File, chunkSize: number): Promise<string> => {
    return new Promise((resolve) => {
      const chunks = Math.ceil(file.size / chunkSize);
      const spark = new SparkMD5.ArrayBuffer();
      let currentChunk = 0;

      const reader = new FileReader();

      /* 处理分片 */
      const processChunk = (deadline?: IdleDeadline) => {
        /* 检查是否需要让出控制权 */
        if (deadline && deadline.timeRemaining() < 1) {
          requestIdleCallback(processChunk);
          return;
        }

        if (currentChunk < chunks) {
          const start = currentChunk * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);

          reader.readAsArrayBuffer(chunk);
        } else {
          /* 所有分片处理完成，计算哈希值 */
          const hash = spark.end();
          hashCache.current.set(file.name, hash);
          resolve(hash);
        }
      };

      reader.onload = (e) => {
        if (e.target?.result) {
          spark.append(e.target.result as ArrayBuffer);
          currentChunk++;

          /* 在空闲时间调度下一个分片处理 */
          requestIdleCallback(processChunk);
        }
      };

      reader.onerror = () => {
        updateFileProgress(file.name, {
          status: 'error',
          message: '计算文件哈希值失败',
        });
      };

      /* 开始处理第一个分片 */
      requestIdleCallback(processChunk);
    });
  };

  /* 检查文件是否已存在或获取已上传的分片 */
  const checkFileStatus = async (hash: string, filename: string) => {
    try {
      const response = await fetch(`/api/upload?hash=${hash}&filename=${filename}`);
      const data = await response.json();

      if (data.exists) {
        /* 文件已存在（秒传） */
        updateFileProgress(filename, {
          percentage: 100,
          uploadedChunks: 1,
          totalChunks: 1,
          status: 'completed',
          message: '文件秒传成功！',
        });

        setFiles((prev) =>
          prev.map((file) => (file.raw.name === filename ? { ...file, url: data.url } : file)),
        );

        toast.success('文件秒传成功');

        return { exists: true };
      } else {
        /* 文件不存在，但可能有一些分片已上传 */
        return {
          exists: false,
          uploadedChunks: data.uploadedChunks || [],
        };
      }
    } catch (error) {
      console.error('Error checking file status:', error);
      return { exists: false, uploadedChunks: [] };
    }
  };

  /* 上传单个分片 */
  const uploadChunk = async (
    chunk: Blob,
    index: number,
    hash: string,
    filename: string,
    totalChunks: number,
  ) => {
    try {
      const formData = new FormData();
      formData.append('file', chunk);
      formData.append('hash', hash);
      formData.append('filename', filename);
      formData.append('chunkIndex', index.toString());
      formData.append('chunks', totalChunks.toString());

      const controller = abortControllers.current.get(filename);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Upload aborted');
        return { aborted: true };
      }
      throw error;
    }
  };

  /* 上传文件 */
  const uploadFile = async (file: UploadFile) => {
    try {
      const { raw, progress: currentProgress } = file;
      let hash = file.hash;

      /* 重置状态 */
      if (currentProgress.status !== 'paused') {
        updateFileProgress(raw.name, {
          percentage: 0,
          uploadedChunks: 0,
          totalChunks: 0,
          status: 'uploading',
          message: '准备上传...',
        });
      } else {
        /* resume */
        updateFileProgress(raw.name, {
          status: 'uploading',
          message: '继续上传文件...',
        });
      }

      /* 创建新的 abort controller */
      const controller = new AbortController();
      abortControllers.current.set(raw.name, controller);

      /* 计算文件哈希值 */
      if (!hash) {
        updateFileProgress(raw.name, { message: '计算文件哈希...' });
        hash = await calculateHash(raw, HASH_CHUNK_SIZE);

        setFiles((prev) => prev.map((f) => (f.raw.name === raw.name ? { ...f, hash } : f)));
      }

      /* 检查文件是否已存在或获取已上传的分片 */
      updateFileProgress(raw.name, { message: '检查文件状态...' });
      const { exists, uploadedChunks = [] } = await checkFileStatus(hash, raw.name);

      await sleep(1000);

      if (exists) return; /* 文件已存在，不需要上传 */

      /* 计算总分片数 */
      const totalChunks = Math.ceil(raw.size / CHUNK_SIZE);
      updateFileProgress(raw.name, {
        totalChunks,
        message: '开始上传文件...',
      });

      /* 上传分片 */
      let completedChunks = 0;

      for (let i = 0; i < totalChunks; i++) {
        /* 跳过已上传的分片 */
        if (uploadedChunks.includes(i)) {
          completedChunks++;
          continue;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(raw.size, start + CHUNK_SIZE);
        const chunk = raw.slice(start, end);

        /* 更新进度 */
        updateFileProgress(raw.name, {
          uploadedChunks: completedChunks,
          percentage: Math.floor((completedChunks / totalChunks) * 100),
          message: `上传分片 ${i + 1}/${totalChunks}...`,
        });

        /* 上传分片 */
        const result = await uploadChunk(chunk, i, hash, raw.name, totalChunks);

        if (result.aborted) {
          updateFileProgress(raw.name, {
            status: 'paused',
            message: '上传已暂停',
          });
          return;
        }

        completedChunks++;

        /* 更新进度 */
        updateFileProgress(raw.name, {
          uploadedChunks: completedChunks,
          percentage: Math.floor((completedChunks / totalChunks) * 100),
          message:
            completedChunks === totalChunks
              ? '所有分片上传完成，正在合并...'
              : `分片 ${i + 1}/${totalChunks} 上传完成`,
        });

        /* 如果这是最后一个分片，文件上传完成 */
        if (result.url) {
          updateFileProgress(raw.name, {
            percentage: 100,
            status: 'completed',
            message: '文件上传成功！',
          });

          toast.success('文件上传成功');

          setFiles((prev) =>
            prev.map((f) => (f.raw.name === raw.name ? { ...f, url: result.url } : f)),
          );

          hashCache.current.delete(raw.name);
          abortControllers.current.delete(raw.name);
          break;
        }
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      updateFileProgress(file.raw.name, {
        status: 'error',
        message: '上传失败，请重试',
      });
    }
  };

  const pauseUpload = (filename: string) => {
    const controller = abortControllers.current.get(filename);
    if (controller) {
      controller.abort();
      updateFileProgress(filename, {
        status: 'paused',
        message: '上传已暂停',
      });
    }
  };

  const resumeUpload = (filename: string) => {
    const file = files.find((f) => f.raw.name === filename);
    if (file) {
      uploadFile(file);
    }
  };

  const removeFile = (filename: string) => {
    const controller = abortControllers.current.get(filename);
    if (controller) {
      controller.abort();
    }
    abortControllers.current.delete(filename);
    hashCache.current.delete(filename);
    setFiles((prev) => prev.filter((file) => file.raw.name !== filename));
  };

  const resetAll = () => {
    /* 中止所有正在进行的上传 */
    abortControllers.current.forEach((controller) => {
      controller.abort();
    });

    /* 清除所有引用 */
    abortControllers.current.clear();
    hashCache.current.clear();
    setFiles([]);
  };

  return {
    files,
    addFiles,
    removeFile,
    uploadFile,
    pauseUpload,
    resumeUpload,
    resetAll,
  };
};

const FileUploader = () => {
  const [count, setCount] = useState(0);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const { files, addFiles, uploadFile, pauseUpload, resumeUpload, removeFile, resetAll } =
    useFileUploader();

  /* 处理文件选择 */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  };

  /* 处理上传所有按钮点击 */
  const handleUploadAll = async () => {
    /* 过滤需要上传的文件 */
    const filesToUpload = files.filter(
      (file) => file.progress.status === 'idle' || file.progress.status === 'error',
    );

    if (filesToUpload.length === 0) return;

    /* 设置最大并发上传数 */
    const MAX_CONCURRENT_UPLOADS = 3;

    /* 处理文件批次以限制并发 */
    const processFiles = async (files: UploadFile[]) => {
      /* 处理批次 */
      for (let i = 0; i < files.length; i += MAX_CONCURRENT_UPLOADS) {
        const batch = files.slice(i, i + MAX_CONCURRENT_UPLOADS);

        /* 并发上传文件 */
        await Promise.all(batch.map((file) => uploadFile(file)));
      }
    };

    /* 开始处理文件 */
    await processFiles(filesToUpload);
  };

  return (
    <Card className="m-auto flex w-1/2 flex-col gap-4 p-8">
      <Toaster position="top-center" richColors />
      <Input type="file" onChange={handleFileChange} multiple />
      {files.length > 0 && (
        <>
          {files.map((file) => (
            <Card
              key={file.raw.name}
              className="relative flex flex-col gap-2 rounded-lg border border-gray-200 p-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">{file.raw.name}</p>
                  <p className="text-xs text-gray-500">
                    大小: {(file.raw.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  className="absolute right-1 top-1"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(file.raw.name)}
                >
                  ✕
                </Button>
              </div>

              {file.progress.status !== 'idle' && (
                <div>
                  <Progress value={file.progress.percentage} />
                  <p className="mt-1 text-xs text-gray-700">
                    {file.progress.message} ({file.progress.percentage}%)
                  </p>
                </div>
              )}

              <div className="flex space-x-2">
                {file.progress.status === 'idle' && (
                  <Button className="bg-blue-600" size="sm" onClick={() => uploadFile(file)}>
                    上传
                  </Button>
                )}

                {file.progress.status === 'uploading' && (
                  <Button
                    className="bg-yellow-600"
                    size="sm"
                    onClick={() => pauseUpload(file.raw.name)}
                  >
                    暂停
                  </Button>
                )}

                {file.progress.status === 'paused' && (
                  <Button
                    className="bg-green-600"
                    size="sm"
                    onClick={() => resumeUpload(file.raw.name)}
                  >
                    继续
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </>
      )}
      {files.length > 0 && (
        <div className="flex space-x-2">
          <Button className="bg-blue-600" onClick={handleUploadAll}>
            全部上传
          </Button>
          <Button className="bg-gray-600" onClick={resetAll}>
            清空列表
          </Button>
        </div>
      )}
      <h2 className="font-medium text-gray-500">上传成功文件在根目录下 /file/complete 目录下</h2>
      {/* 测试区域 */}
      <div className="mt-8 border-t pt-4">
        <h3 className="mb-4 text-lg font-medium">测试</h3>
        <div className="flex items-center space-x-4">
          <Button
            onClick={() => {
              if (timer.current) {
                clearInterval(timer.current);
                timer.current = null;
                setCount(0);
                return;
              }
              timer.current = setInterval(() => {
                setCount((prev) => prev + 1);
              }, 100);
            }}
          >
            {count ? '停止计数' : '开始计数'}
          </Button>
          <div className="rounded-md border border-gray-300 bg-gray-50 px-4 py-2">
            计数: <span>{count}</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          点击按钮开始计数测试，如果上传过程中计数能正常增加，说明响应性良好
        </p>
      </div>
    </Card>
  );
};

export default FileUploader;
