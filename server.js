const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.BOOKMARK_PASSWORD || 'dong123';

const DATA_FILE = path.join(__dirname, 'data', 'bookmarks.json');

// === Session tokens (in-memory, cleared on restart) ===
const validTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// === Auth middleware ===
function authMiddleware(req, res, next) {
  // If no password set, skip auth
  if (!PASSWORD) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未授权，请先登录', needAuth: true });
  }
  const token = authHeader.slice(7);
  if (!validTokens.has(token)) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录', needAuth: true });
  }
  next();
}

// === Auth API ===
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== PASSWORD) {
    return res.status(401).json({ success: false, error: '密码错误' });
  }
  const token = generateToken();
  validTokens.add(token);
  res.json({ success: true, token });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    validTokens.delete(authHeader.slice(7));
  }
  res.json({ success: true });
});

app.get('/api/auth/status', (_req, res) => {
  res.json({ success: true, needAuth: !!PASSWORD });
});

const DEFAULT_GROUPS = [
  { id: 'g1', name: '开发工具', color: '#667eea' },
  { id: 'g2', name: '社交媒体', color: '#f5576c' },
  { id: 'g3', name: '学习资源', color: '#43e97b' },
  { id: 'g4', name: '常用工具', color: '#4facfe' },
];

const DEFAULT_BOOKMARKS = [
  { id: '1', title: 'GitHub', url: 'https://github.com', color: 'gradient8', groupId: 'g1' },
  { id: '2', title: '谷歌', url: 'https://www.google.com', color: 'gradient3', groupId: 'g4' },
  { id: '3', title: '百度', url: 'https://www.baidu.com', color: 'gradient4', groupId: 'g4' },
  { id: '4', title: 'B站', url: 'https://www.bilibili.com', color: 'gradient2', groupId: 'g2' },
  { id: '5', title: '知乎', url: 'https://www.zhihu.com', color: 'gradient3', groupId: 'g2' },
  { id: '6', title: '掘金', url: 'https://juejin.cn', color: 'gradient1', groupId: 'g1' },
  { id: '7', title: '微信公众平台', url: 'https://mp.weixin.qq.com', color: 'gradient6', groupId: 'g4' },
  { id: '8', title: 'YouTube', url: 'https://www.youtube.com', color: 'gradient2', groupId: 'g3' },
  { id: '9', title: 'Stack Overflow', url: 'https://stackoverflow.com', color: 'gradient5', groupId: 'g1' },
  { id: '10', title: '语雀', url: 'https://www.yuque.com', color: 'gradient6', groupId: 'g3' },
  { id: '11', title: '飞书', url: 'https://www.feishu.cn', color: 'gradient3', groupId: 'g4' },
  { id: '12', title: 'V2EX', url: 'https://www.v2ex.com', color: 'gradient8', groupId: 'g2' },
];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = { bookmarks: DEFAULT_BOOKMARKS, groups: DEFAULT_GROUPS };
      writeData(initial);
      return JSON.parse(JSON.stringify(initial));
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    let data = JSON.parse(raw);
    if (Array.isArray(data)) {
      data = { bookmarks: data, groups: DEFAULT_GROUPS };
      writeData(data);
    }
    if (!data.groups) data.groups = DEFAULT_GROUPS;
    if (!data.bookmarks) data.bookmarks = [];
    return data;
  } catch (e) {
    return { bookmarks: [...DEFAULT_BOOKMARKS], groups: [...DEFAULT_GROUPS] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

app.use(express.static(path.join(__dirname, 'public')));

// === Protected: Bookmark APIs ===
app.get('/api/bookmarks', authMiddleware, (_req, res) => {
  try {
    const { bookmarks, groups } = readData();
    res.json({ success: true, data: bookmarks, groups });
  } catch (e) {
    res.status(500).json({ success: false, error: '读取书签失败' });
  }
});

app.post('/api/bookmarks', authMiddleware, (req, res) => {
  try {
    const { title, url, color, icon, groupId } = req.body;
    if (!title || !url) {
      return res.status(400).json({ success: false, error: '名称和网址不能为空' });
    }
    const data = readData();
    const newBm = { id: generateId(), title, url, color: color || 'gradient1', icon: icon || '', groupId: groupId || '' };
    data.bookmarks.push(newBm);
    writeData(data);
    res.json({ success: true, data: newBm });
  } catch (e) {
    res.status(500).json({ success: false, error: '添加书签失败' });
  }
});

app.put('/api/bookmarks/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { title, url, color, icon, groupId } = req.body;
    const data = readData();
    const idx = data.bookmarks.findIndex(b => b.id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '书签不存在' });
    }
    data.bookmarks[idx] = { ...data.bookmarks[idx], title, url, color, icon, groupId };
    writeData(data);
    res.json({ success: true, data: data.bookmarks[idx] });
  } catch (e) {
    res.status(500).json({ success: false, error: '更新书签失败' });
  }
});

app.delete('/api/bookmarks/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    let data = readData();
    const exists = data.bookmarks.some(b => b.id === id);
    if (!exists) {
      return res.status(404).json({ success: false, error: '书签不存在' });
    }
    data.bookmarks = data.bookmarks.filter(b => b.id !== id);
    writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '删除书签失败' });
  }
});

app.post('/api/bookmarks/reset', authMiddleware, (_req, res) => {
  try {
    const data = {
      bookmarks: DEFAULT_BOOKMARKS.map(b => ({...b})),
      groups: DEFAULT_GROUPS.map(g => ({...g})),
    };
    writeData(data);
    res.json({ success: true, data: data.bookmarks, groups: data.groups });
  } catch (e) {
    res.status(500).json({ success: false, error: '重置失败' });
  }
});

// === Protected: Group APIs ===
app.get('/api/groups', authMiddleware, (_req, res) => {
  try {
    const { groups } = readData();
    res.json({ success: true, data: groups });
  } catch (e) {
    res.status(500).json({ success: false, error: '读取分组失败' });
  }
});

app.post('/api/groups', authMiddleware, (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: '分组名称不能为空' });
    }
    const data = readData();
    const newGroup = { id: generateId(), name: name.trim(), color: color || '#667eea' };
    data.groups.push(newGroup);
    writeData(data);
    res.json({ success: true, data: newGroup });
  } catch (e) {
    res.status(500).json({ success: false, error: '添加分组失败' });
  }
});

app.put('/api/groups/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;
    const data = readData();
    const idx = data.groups.findIndex(g => g.id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '分组不存在' });
    }
    if (name !== undefined) data.groups[idx].name = name;
    if (color !== undefined) data.groups[idx].color = color;
    writeData(data);
    res.json({ success: true, data: data.groups[idx] });
  } catch (e) {
    res.status(500).json({ success: false, error: '更新分组失败' });
  }
});

app.delete('/api/groups/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    let data = readData();
    const exists = data.groups.some(g => g.id === id);
    if (!exists) {
      return res.status(404).json({ success: false, error: '分组不存在' });
    }
    data.groups = data.groups.filter(g => g.id !== id);
    data.bookmarks.forEach(bm => { if (bm.groupId === id) bm.groupId = ''; });
    writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '删除分组失败' });
  }
});

app.listen(PORT, () => {
  console.log(`Bookmark server running at http://localhost:${PORT}`);
  console.log(`Auth: ${PASSWORD ? 'enabled' : 'disabled'}`);
});
