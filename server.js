const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.BOOKMARK_PASSWORD || '7515';

const DATA_FILE = path.join(__dirname, 'data', 'bookmarks.json');

// === Cloud Data Storage (GitHub Gist) ===
// Data persists in a private GitHub Gist so it survives Render container rebuilds
const GIST_ID = process.env.GIST_ID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const USE_GIST = !!(GIST_ID && GITHUB_TOKEN);
let cachedData = null;
let syncTimer = null;

async function loadFromGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`Gist API ${res.status}`);
  const gist = await res.json();
  const content = JSON.parse(gist.files['bookmarks.json'].content);
  return content;
}

async function syncToGist(data) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { 'bookmarks.json': { content: JSON.stringify(data, null, 2) } } })
  });
  if (!res.ok) throw new Error(`Gist sync ${res.status}`);
}

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
  // Use in-memory cache if available (set from Gist on startup or after writes)
  if (cachedData) return JSON.parse(JSON.stringify(cachedData));
  // Fallback to local file
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
  cachedData = data;
  // Write to local file as backup
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { /* ignore local file errors */ }
  // Sync to Gist (debounced 1s, non-blocking)
  if (USE_GIST) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncToGist(cachedData).catch(e => console.error('Gist sync failed:', e.message));
    }, 1000);
  }
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

app.put('/api/bookmarks/reorder', authMiddleware, (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ success: false, error: '需要书签ID数组' });
    }
    const data = readData();
    const reordered = ids.map(id => data.bookmarks.find(b => b.id === id)).filter(Boolean);
    const remaining = data.bookmarks.filter(b => !ids.includes(b.id));
    data.bookmarks = [...reordered, ...remaining];
    writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '排序失败' });
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

// Bulk import: groups + bookmarks in one request
app.post('/api/import', authMiddleware, (req, res) => {
  try {
    const { groups: inGroups, bookmarks: inBookmarks } = req.body;
    if (!Array.isArray(inBookmarks)) {
      return res.status(400).json({ success: false, error: '书签数据格式错误' });
    }
    const data = readData();
    const idMap = {};
    // Create groups, map old IDs to new
    if (Array.isArray(inGroups)) {
      for (const g of inGroups) {
        const ng = { id: generateId(), name: g.name || '未命名', color: g.color || '#667eea' };
        data.groups.push(ng);
        idMap[g.id] = ng.id;
      }
    }
    // Create bookmarks with remapped group IDs
    let added = 0;
    for (const bm of inBookmarks) {
      if (!bm.title || !bm.url) continue;
      const groupId = idMap[bm.groupId] || bm.groupId || '';
      data.bookmarks.push({
        id: generateId(),
        title: bm.title,
        url: bm.url,
        color: bm.color || 'gradient1',
        icon: bm.icon || '',
        groupId
      });
      added++;
    }
    writeData(data);
    res.json({ success: true, data: { groupsAdded: idMap.size || Object.keys(idMap).length, bookmarksAdded: added } });
  } catch (e) {
    res.status(500).json({ success: false, error: '导入失败: ' + e.message });
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
    data.bookmarks = data.bookmarks.filter(bm => bm.groupId !== id);
    writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '删除分组失败' });
  }
});

app.post('/api/groups/batch-delete', authMiddleware, (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '需要分组ID数组' });
    }
    let data = readData();
    const idSet = new Set(ids);
    data.groups = data.groups.filter(g => !idSet.has(g.id));
    data.bookmarks = data.bookmarks.filter(bm => !idSet.has(bm.groupId));
    writeData(data);
    res.json({ success: true, deleted: ids.length });
  } catch (e) {
    res.status(500).json({ success: false, error: '批量删除失败' });
  }
});

app.put('/api/groups/reorder', authMiddleware, (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ success: false, error: '需要分组ID数组' });
    }
    const data = readData();
    const reordered = ids.map(id => data.groups.find(g => g.id === id)).filter(Boolean);
    const remaining = data.groups.filter(g => !ids.includes(g.id));
    data.groups = [...reordered, ...remaining];
    writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '分组排序失败' });
  }
});

// === Protected: Fetch website meta (title + favicon) ===
app.get('/api/fetch-meta', authMiddleware, (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ success: false, error: '缺少 url 参数' });

    const fullUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    const urlObj = new URL(fullUrl);
    const proto = urlObj.protocol === 'https:' ? require('https') : require('http');
    const domain = urlObj.hostname;

    // Google favicon fallback
    const fallbackIcon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    const fetchOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 5000,
    };

    proto.get(fullUrl, fetchOptions, (resp) => {
      // Follow redirects (max 3)
      if ([301, 302, 303, 307, 308].includes(resp.statusCode)) {
        const redirect = resp.headers.location;
        if (redirect) {
          const redirectUrl = redirect.startsWith('http') ? redirect : urlObj.origin + redirect;
          proto.get(redirectUrl, { ...fetchOptions, timeout: 5000 }, (resp2) => {
            handleResponse(resp2, res, domain, fallbackIcon);
          }).on('error', () => sendFallback(res, domain, fallbackIcon))
           .on('timeout', function() { this.destroy(); sendFallback(res, domain, fallbackIcon); });
          return;
        }
      }
      handleResponse(resp, res, domain, fallbackIcon);
    }).on('error', () => sendFallback(res, domain, fallbackIcon))
      .on('timeout', function() { this.destroy(); sendFallback(res, domain, fallbackIcon); });
  } catch (e) {
    res.status(400).json({ success: false, error: 'URL 格式不正确' });
  }
});

function handleResponse(resp, res, domain, fallbackIcon) {
  const chunks = [];
  resp.on('data', chunk => {
    chunks.push(chunk);
    // Limit content size
    if (chunks.reduce((s, c) => s + c.length, 0) > 500000) resp.destroy();
  });
  resp.on('end', () => {
    const html = Buffer.concat(chunks).toString('utf-8');
    // Extract <title>
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // Extract favicon from <link> tags
    const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i)
                   || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
    let icon = '';
    if (iconMatch) {
      const href = iconMatch[1];
      icon = href.startsWith('http') ? href : (href.startsWith('//') ? 'https:' + href : 'https://' + domain + (href.startsWith('/') ? '' : '/') + href);
    } else {
      icon = fallbackIcon;
    }
    res.json({ success: true, title, icon });
  });
  resp.on('error', () => sendFallback(res, domain, fallbackIcon));
}

function sendFallback(res, domain, fallbackIcon) {
  res.json({ success: true, title: '', icon: fallbackIcon });
}

async function startServer(listenPort) {
  if (USE_GIST) {
    try {
      cachedData = await loadFromGist();
      console.log('Data loaded from GitHub Gist');
    } catch (e) {
      console.error('Failed to load from Gist, using local file:', e.message);
    }
  }
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = data.toString();
      // Echo back with metadata
      ws.send(JSON.stringify({ type: 'echo', payload: msg, timestamp: Date.now() }));
    });
    ws.on('error', (err) => console.error('WebSocket error:', err.message));
  });

  return new Promise((resolve, reject) => {
    const p = listenPort ?? PORT;
    server.listen(p, () => {
      const addr = server.address();
      console.log(`Bookmark server running at http://localhost:${addr.port}`);
      console.log(`Auth: ${PASSWORD ? 'enabled' : 'disabled'}`);
      console.log(`Storage: ${USE_GIST ? 'GitHub Gist (persistent)' : 'Local file (ephemeral)'}`);
      resolve({ server, wss, port: addr.port });
    });
    server.once('error', reject);
  });
}

module.exports = { app, startServer };

if (require.main === module) startServer();
