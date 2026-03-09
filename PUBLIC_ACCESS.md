# 公网访问配置指南

## 当前状态
- ✅ 本机访问：http://localhost:3000
- ✅ 局域网访问：http://192.168.1.7:3000
- ⏳ 公网访问：需要配置

## 方案一：ngrok（推荐，最简单）

### 1. 注册ngrok账号
访问 https://ngrok.com/ 注册免费账号

### 2. 获取认证令牌
登录后在 https://dashboard.ngrok.com/get-started/your-authtoken 获取你的authtoken

### 3. 配置ngrok
```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

### 4. 启动ngrok隧道
```bash
ngrok http 3000
```

### 5. 获取公网URL
启动后会显示类似这样的URL：
```
Forwarding: https://xxxx-xx-xx-xx-xx.ngrok-free.app -> http://localhost:3000
```

这个https地址就是你的公网访问地址！

### ngrok优点
- ✅ 免费版可用
- ✅ 配置简单，一条命令搞定
- ✅ 自动HTTPS加密
- ✅ 无需修改路由器设置
- ⚠️ 免费版URL每次重启会变化
- ⚠️ 免费版有连接数限制

---

## 方案二：Cloudflare Tunnel（免费，稳定）

### 1. 安装cloudflared
```bash
brew install cloudflare/cloudflare/cloudflared
```

### 2. 登录Cloudflare
```bash
cloudflared tunnel login
```

### 3. 创建隧道
```bash
cloudflared tunnel create baiye-manager
```

### 4. 配置隧道
创建配置文件 `~/.cloudflared/config.yml`：
```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /Users/a123/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: baiye.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 5. 启动隧道
```bash
cloudflared tunnel run baiye-manager
```

### Cloudflare优点
- ✅ 完全免费
- ✅ 可以使用自定义域名
- ✅ 稳定可靠
- ✅ 自动HTTPS
- ⚠️ 需要有域名（可以用Cloudflare的免费域名）

---

## 方案三：frp（自建，完全控制）

### 1. 需要一台有公网IP的服务器
租用阿里云/腾讯云等服务器（最低配置即可）

### 2. 服务器端配置
下载并配置frps（服务端）

### 3. 本地配置
下载并配置frpc（客户端）

### frp优点
- ✅ 完全自主控制
- ✅ 无连接数限制
- ✅ 可以自定义域名
- ⚠️ 需要有公网服务器（有成本）
- ⚠️ 配置相对复杂

---

## 方案四：Serveo（最简单，无需注册）

### 直接运行
```bash
ssh -R 80:localhost:3000 serveo.net
```

会自动分配一个公网URL，如：https://xxx.serveo.net

### Serveo优点
- ✅ 无需注册
- ✅ 一条命令搞定
- ✅ 完全免费
- ⚠️ URL每次重启会变化
- ⚠️ 稳定性一般

---

## 推荐方案

### 临时使用（测试、演示）
**推荐：ngrok 或 Serveo**
- 快速启动，立即可用
- 适合短期使用

### 长期使用（生产环境）
**推荐：Cloudflare Tunnel**
- 稳定可靠
- 完全免费
- 可以绑定自己的域名

---

## 快速开始（ngrok）

1. 访问 https://ngrok.com/ 注册账号
2. 复制你的authtoken
3. 运行以下命令：

```bash
# 配置认证
ngrok config add-authtoken YOUR_AUTH_TOKEN

# 启动隧道
ngrok http 3000
```

4. 复制显示的公网URL，分享给其他人即可访问！

---

## 安全提示

⚠️ 公网访问意味着任何人都可以访问你的应用，建议：
1. 添加登录认证功能
2. 使用HTTPS（ngrok和Cloudflare自动提供）
3. 定期更换公网URL
4. 不要在公网URL中包含敏感信息

---

## 需要帮助？

如果需要配置任何方案，请告诉我你选择哪个方案，我会帮你完成配置！
