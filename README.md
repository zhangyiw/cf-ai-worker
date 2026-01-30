# cf-ai-worker

基于 Cloudflare Workers 的 OpenAI 兼容 API 网关，支持多种 AI 模型。

## 功能特性

- **OpenAI 兼容 API** - 支持 `/v1/chat/completions` 和 `/v1/responses` 端点
- **多种模型支持** - GPT-4、GPT-3.5、Llama、DeepSeek 等模型映射
- **流式响应** - 支持 SSE 流式输出
- **API 密钥认证** - 通过环境变量配置访问控制
- **CORS 支持** - 跨域请求支持，方便浏览器调用

## 支持的模型

| OpenAI 模型 | 实际使用模型 |
|------------|-------------|
| gpt-4 / gpt-4o | @cf/meta/llama-3.1-70b-instruct |
| gpt-4o-mini / gpt-3.5-turbo | @cf/meta/llama-3.1-8b-instruct |
| llama-3.1-8b | @cf/meta/llama-3.1-8b-instruct |
| llama-3.1-70b | @cf/meta/llama-3.1-70b-instruct |
| deepseek-r1 / deepseek-chat | @cf/deepseek-ai/deepseek-r1-distill-qwen-32b |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发

```bash
npm run dev
```

### 3. 部署到 Cloudflare

```bash
npm run deploy
```

### 4. 配置 API 密钥（可选）

```bash
npx wrangler secret put OPENAI_API_KEY
```

## API 使用

### Chat Completions API

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

### Responses API

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4o",
    "input": [
      {"role": "user", "content": [{"type": "input_text", "text": "你好"}]}
    ]
  }'
```

### 使用 OpenAI SDK

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://your-worker.your-subdomain.workers.dev/v1',
  apiKey: 'your-api-key'
});

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

## 配置说明

### wrangler.jsonc

```json
{
  "name": "cf-ai-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-28",
  "ai": {
    "binding": "AI"
  },
  "vars": {
    "OPENAI_API_KEY": ""
  }
}
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `OPENAI_API_KEY` | API 访问密钥，为空时不验证 |

## 项目结构

```
cf-ai-worker/
├── src/
│   └── index.ts          # 主入口文件
├── public/
│   └── index.html        # 静态页面
├── wrangler.jsonc        # Cloudflare 配置
├── package.json          # 项目依赖
└── README.md             # 项目说明
```

## 技术栈

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Workers AI](https://developers.cloudflare.com/workers-ai/) - AI 推理服务
- TypeScript - 类型安全的 JavaScript
- Wrangler - Cloudflare CLI 工具

## 注意事项

1. 首次部署前需要在 Cloudflare Dashboard 启用 Workers AI
2. API 密钥通过 `Authorization: Bearer <key>` 头部传递
3. 不配置 `OPENAI_API_KEY` 时，API 无需认证即可访问
4. 流式响应使用 Server-Sent Events (SSE) 格式

## License

MIT
