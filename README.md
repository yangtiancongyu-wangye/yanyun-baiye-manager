# 燕云十六声百业战管理工具

## 部署到 Render.com

1. 访问 https://render.com 并注册账号
2. 点击 "New +" -> "Web Service"
3. 连接此 GitHub 仓库
4. 配置：
   - Name: yanyun-baiye-manager
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free

5. 点击 "Create Web Service"

部署完成后会获得一个固定的 `.onrender.com` 域名。

## 本地运行

```bash
npm install
npm start
```

访问 http://localhost:3000
