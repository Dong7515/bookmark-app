const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'bookmarks.json');

const DEFAULT_BOOKMARKS = [
  { id: '1', title: 'GitHub', url: 'https://github.com', color: 'gradient8' },
  { id: '2', title: '谷歌', url: 'https://www.google.com', color: 'gradient3' },
  { id: '3', title: '百度', url: 'https://www.baidu.com', color: 'gradient4' },
  { id: '4', title: 'B站', url: 'https://www.bilibili.com', color: 'gradient2' },
  { id: '5', title: '知乎', url: 'https://www.zhihu.com', color: 'gradient3' },
  { id: '6', title: '掘金', url: 'https://juejin.cn', color: 'gradient1' },
  { id: '7', title: '微信公众平台', url: 'https://mp.weixin.qq.com', color: 'gradient6' },
  { id: '8', title: 'YouTube', url: 'https://www.youtube.com', color: 'gradient2' },
  { id: '9', title: 'Stack Overflow', url: 'https://stackoverflow.com', color: 'gradient5' },
  { id: '10', title: '语雀', url: 'https://www.yuque.com', color: 'gradient6' },
  { id: '11', title: '飞书', url: 'https://www.feishu.cn', color: 'gradient3' },
  { id: '12', title: 'V2EX', url: 'https://www.v2ex.com', color: 'gradient8' },
];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readBookmarks() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      writeBookmarks(DEFAULT_BOOKMARKS);
      return [...DEFAULT_BOOKMARKS];
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [...DEFAULT_BOOKMARKS];
  }
}

function writeBookmarks(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: list all bookmarks
app.get('/api/bookmarks', (_req, res) => {
  try {
    const bookmarks = readBookmarks();
    res.json({ success: true, data: bookmarks });
  } catch (e) {
    res.status(500).json({ success: false, error: '读取书签失败' });
  }
});

// API: add a bookmark
app.post('/api/bookmarks', (req, res) => {
  try {
    const { title, url, color, icon } = req.body;
    if (!title || !url) {
      return res.status(400).json({ success: false, error: '名称和网址不能为空' });
    }
    const bookmarks = readBookmarks();
    const newBm = { id: generateId(), title, url, color: color || 'gradient1', icon: icon || '' };
    bookmarks.push(newBm);
    writeBookmarks(bookmarks);
    res.json({ success: true, data: newBm });
  } catch (e) {
    res.status(500).json({ success: false, error: '添加书签失败' });
  }
});

// API: update a bookmark
app.put('/api/bookmarks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, url, color, icon } = req.body;
    const bookmarks = readBookmarks();
    const idx = bookmarks.findIndex(b => b.id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '书签不存在' });
    }
    bookmarks[idx] = { ...bookmarks[idx], title, url, color, icon };
    writeBookmarks(bookmarks);
    res.json({ success: true, data: bookmarks[idx] });
  } catch (e) {
    res.status(500).json({ success: false, error: '更新书签失败' });
  }
});

// API: delete a bookmark
app.delete('/api/bookmarks/:id', (req, res) => {
  try {
    const { id } = req.params;
    let bookmarks = readBookmarks();
    const exists = bookmarks.some(b => b.id === id);
    if (!exists) {
      return res.status(404).json({ success: false, error: '书签不存在' });
    }
    bookmarks = bookmarks.filter(b => b.id !== id);
    writeBookmarks(bookmarks);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '删除书签失败' });
  }
});

// API: reset to defaults
app.post('/api/bookmarks/reset', (_req, res) => {
  try {
    writeBookmarks(DEFAULT_BOOKMARKS.map(b => ({...b})));
    res.json({ success: true, data: DEFAULT_BOOKMARKS });
  } catch (e) {
    res.status(500).json({ success: false, error: '重置失败' });
  }
});

app.listen(PORT, () => {
  console.log(`Bookmark server running at http://localhost:${PORT}`);
});
