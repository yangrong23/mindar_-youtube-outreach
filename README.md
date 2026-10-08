# Mindar YouTube Outreach Desk

本地人工审核工作台，用于：

1. 输入最多 10 个英语 YouTube 关键词
2. 使用 YouTube Data API 发现频道
3. 获取频道和近期视频数据
4. 自动评分和分类
5. 人工确认候选
6. 手动录入公开商务邮箱和邀请链接
7. 人工批准后使用 AWS SES 发送
8. 记录发送、回复、退信、退订和邀请链接转化状态

## 启动

```bash
cd /Users/edy/Desktop/mindar-youtube-outreach
cp .env.example .env
# 在 .env 中填入新生成的 YouTube API Key 和 SES 配置
npm start
```

打开 `http://127.0.0.1:61881`。

真实密钥不要放入代码、截图、聊天记录或 Git。之前已经暴露的 AWS/YouTube 密钥必须先撤销并重新生成。

## SES 前置条件

- SES 发件人身份已验证。
- SES 账户已退出 Sandbox，或者收件人也已验证。
- 本机已安装并配置 AWS CLI，且使用的是新建的最小权限 IAM 用户。
- 发送前确认 `OUTREACH_DRY_RUN=false`。

发送使用本机 AWS CLI 的 `sesv2 send-email`，工具不会保存 AWS Secret。

## 邮箱来源规则

YouTube API 不会返回私人邮箱。只能人工确认：

- 频道公开的商务联系邮箱
- 创作者官网公开的联系邮箱
- 创作者主动提供的邮箱

不要抓取隐藏邮箱、登录后邮箱或第三方数据泄露。

## 记录转化

工具会为每个候选生成带 `outreach_id`、`utm_source=youtube_outreach` 和 `utm_campaign` 的邀请链接。实际注册/首次使用事件还需要 Mindar 产品端把这些参数写入注册和行为埋点。

退信、投诉和回复需要从 SES/SNS 或邮箱服务商 webhook 同步到本工具；当前页面支持人工更新状态，并预留 `/api/events` 接收事件。
