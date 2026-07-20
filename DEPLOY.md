# UnMeet v0.1.1 — 内部测试部署指南

## 给 20 人团队的安装说明

### 方式一：Chrome Web Store Unlisted（推荐）

> Unlisted = 不公开搜索到，只有知道链接的人能安装。不会被竞争对手看到。

**管理员操作：**

1. 打开 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 点击 **"New Item"**
3. 上传 `unmeet-v0.1.1.zip`
4. 填写商店信息：
   - **Name**: UnMeet
   - **Description (short)**: Measure the real cost of your meetings.
   - **Description (full)**: UnMeet automatically tracks time spent in meetings, calculates the monetary cost, and helps you identify which meetings are worth your time — and which ones aren't.
   - **Category**: Productivity
   - **Language**: English (United States)
5. 在 **Privacy** 标签页：
   - **Single purpose**: "Track meeting time and calculate meeting costs"
   - **Permission justification > Tabs**: "To detect when a meeting tab is open and active for automatic time tracking"
   - **Permission justification > Storage**: "To store meeting history and user preferences locally on device"
   - **Permission justification > Host permissions**: "To detect meeting sessions on Google Meet, Zoom, Microsoft Teams, Feishu, and other meeting platforms"
   - **Data usage**: 勾选 "I confirm that this extension does not collect, use, or share any user data"
6. 在 **Distribution** 标签页：
   - **Visibility**: 选择 **"Unlisted"**
7. 提交审核（通常 1-2 天通过）
8. 审核通过后，会得到一个链接，格式类似：
   ```
   https://chromewebstore.google.com/detail/unmeet/[extension-id]
   ```

**团队成员操作：**

打开上面的链接 → 点击 "Add to Chrome" → 完成。不需要任何配置。

---

### 方式二：开发者模式（备选，立即可用）

如果等不了审核（1-2 天）：

1. 把 `extension/` 文件夹打包成 zip 发给团队成员
2. 每人解压到本地
3. 打开 `chrome://extensions`
4. 右上角打开 **"Developer mode"**
5. 点击 **"Load unpacked"**
6. 选择解压后的文件夹

缺点：每次启动 Chrome 会弹"请禁用开发者模式扩展"的警告。

---

## 使用说明（发给团队）

### UnMeet 做什么？

它默默追踪你在浏览器里参加的每一次会议（Google Meet、Zoom Web、Teams、飞书、腾讯会议），告诉你：
- 今天开了多少会
- 这些会值多少钱（按你的时薪计算）
- 哪些会是值得的，哪些是浪费时间

### 怎么用？

1. 安装后什么都不用做——它会自动检测会议
2. 开会时，右上角 UnMeet 图标会变绿
3. **会议结束后**，右下角会弹出一个评分条——点一下星星评价（1-5），或者点 Skip
4. 点击 UnMeet 图标可以看：
   - 当前是否在会议中
   - 今天/本周会议时间
   - 最近会议列表 + 评分
5. 右键 UnMeet 图标 → Options 设置你的时薪

### 隐私说明

- **所有数据存在你的浏览器里**，不上传任何服务器
- **不访问麦克风、摄像头、屏幕内容**
- **只检测浏览器标签页 URL**（检测你是否在 meet.google.com 这类页面上）
- 你的老板/同事**看不到**你的数据

---

## 测试期间需要收集的反馈

| 指标 | 目标 | 如何收集 |
|------|------|---------|
| 安装后 72 小时保留率 | >70% | 统计人数 |
| 会议评价率（评价次数 / 会议次数） | >30% | popup 里看自己数据 |
| "会议成本"数字有冲击力吗？ | 定性反馈 | 直接问你 |
| 想付费继续用吗？ | >30% 说 yes | 直接问你 |
| 最想要的新功能 | 收集 top 3 | Slack/微信投票 |

---

## 已知问题

- 目前只支持 Web 版会议（Meet/Zoom Web/Teams Web/飞书/腾讯会议），不支持桌面客户端
- 会议标题需要连接 Google Calendar 才能自动获取（目前只有时长和平台）
- 你的数据在换电脑/清除浏览器数据后会丢失

---

*有问题直接找我。*
