const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Try importing qrcode-terminal, fallback if not installed yet
let qrcodeTerminal;
try {
  qrcodeTerminal = require('qrcode-terminal');
} catch (e) {
  console.log('qrcode-terminal package is missing, will load without rendering terminal QR codes.');
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure database folder, database file, and uploads root exist
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Global server state cached in memory, synchronized with db.json
let state = {
  activeCollectionId: '',
  activeSceneId: '',
  collections: []
};

// Load State from Database (with backward-compatible migration parser)
function loadState() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      state = JSON.parse(raw);
      console.log('State successfully loaded from db.json');

      // Database Auto-Migration to collection-level Master Sources
      let migrated = false;
      state.collections.forEach(coll => {
        if (!coll.sources) {
          coll.sources = [];
          migrated = true;
        }
        if (!coll.fonts) {
          coll.fonts = [];
          migrated = true;
        }

        coll.scenes.forEach(scene => {
          scene.sources.forEach(src => {
            // Check if this source exists in coll.sources
            const exists = coll.sources.some(s => s.id === src.id || (src.url && s.url === src.url) || (src.type === 'text' && s.content === src.content));
            if (!exists) {
              const masterSrc = {
                id: src.sourceId || src.id || `src_${uuidv4().substring(0, 8)}`,
                name: src.name,
                type: src.type,
                url: src.url || '',
                content: src.content || '',
                style: src.style || {
                  color: '#ffffff',
                  fontSize: '2rem',
                  position: 'center',
                  background: 'rgba(15, 12, 30, 0.65)'
                },
                volume: src.volume !== undefined ? src.volume : 1.0,
                loop: src.loop !== undefined ? src.loop : (src.type === 'audio'),
                aspectRatioMode: src.aspectRatioMode || 'crop',
                manualLayout: src.manualLayout || { scale: 1.0, x: 0, y: 0 },
                isPlaylist: src.isPlaylist || false,
                playlistFiles: src.playlistFiles || [],
                transition: src.transition || 'cut',
                transitionDuration: src.transitionDuration || 300,
                imageDuration: src.imageDuration || 5
              };
              coll.sources.push(masterSrc);
              src.sourceId = masterSrc.id;
              migrated = true;
            } else if (!src.sourceId) {
              const matched = coll.sources.find(s => s.id === src.id || (src.url && s.url === src.url) || (src.type === 'text' && s.content === src.content));
              if (matched) {
                src.sourceId = matched.id;
                migrated = true;
              }
            }
          });
        });
      });

      if (migrated) {
        console.log('Migrated legacy schema to collection-level Master Sources.');
        saveState();
      }

    } else {
      saveState(); // write defaults
    }
  } catch (err) {
    console.error('Error loading db.json, starting with empty state:', err);
  }
}

// Save State to Database
function saveState() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to db.json:', err);
  }
}

loadState();

// Express Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Helper: Get collection directory path
function getCollectionDir(collectionId) {
  const dir = path.join(UPLOADS_DIR, collectionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Multer Setup for Dynamic Collection Storage (supporting multiple array files)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const collectionId = req.body.collectionId || state.activeCollectionId;
    if (!collectionId) {
      return cb(new Error('No active collection specified for dynamic file storage.'));
    }
    const dir = getCollectionDir(collectionId);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalname);
    const basename = path.basename(originalname, ext)
      .replace(/[^\p{L}\p{N}\-_.]/gu, '_')
      .toLowerCase();
    cb(null, `${basename}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: storage });

// Multer Setup for custom Font uploads
const fontStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(UPLOADS_DIR, '_fonts');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalname);
    const basename = path.basename(originalname, ext)
      .replace(/[^\p{L}\p{N}\-_.]/gu, '_')
      .toLowerCase();
    cb(null, `${basename}_${Date.now()}${ext}`);
  }
});
const fontUpload = multer({ storage: fontStorage });


// REST APIs

// 1. Get full database state
app.get('/api/state', (req, res) => {
  res.json(state);
});

// 2. Create a new collection
app.post('/api/collections', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Collection name is required.' });

  const id = `coll_${uuidv4().substring(0, 8)}`;
  const collectionDir = getCollectionDir(id);

  const newCollection = {
    id,
    name,
    folder: `uploads/${id}`,
    sources: [],
    fonts: [],
    scenes: []
  };

  state.collections.push(newCollection);
  if (!state.activeCollectionId) {
    state.activeCollectionId = id;
  }
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newCollection);
});

// 3. Delete a collection (and its media files recursively)
app.delete('/api/collections/:id', (req, res) => {
  const { id } = req.params;
  const index = state.collections.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ error: 'Collection not found.' });

  // Delete physical directory
  const dirPath = path.join(UPLOADS_DIR, id);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  state.collections.splice(index, 1);

  // Re-evaluate active state if deleted collection was active
  if (state.activeCollectionId === id) {
    state.activeCollectionId = state.collections.length > 0 ? state.collections[0].id : '';
    const activeColl = state.collections.find(c => c.id === state.activeCollectionId);
    state.activeSceneId = (activeColl && activeColl.scenes.length > 0) ? activeColl.scenes[0].id : '';
  }
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, message: 'Collection deleted.' });
});

// 4. Create a scene in a collection
app.post('/api/collections/:id/scenes', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Scene name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const sceneId = `scene_${uuidv4().substring(0, 8)}`;
  const newScene = {
    id: sceneId,
    name,
    sources: []
  };

  collection.scenes.push(newScene);

  // Set active scene if none selected
  if (state.activeCollectionId === id && !state.activeSceneId) {
    state.activeSceneId = sceneId;
  }
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newScene);
});

// 5. Delete a scene
app.delete('/api/collections/:id/scenes/:sceneId', (req, res) => {
  const { id, sceneId } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const sceneIndex = collection.scenes.findIndex(s => s.id === sceneId);
  if (sceneIndex === -1) return res.status(404).json({ error: 'Scene not found.' });

  // Note: Layers removed from this scene are NOT deleted from master sources library folder!
  collection.scenes.splice(sceneIndex, 1);

  if (state.activeSceneId === sceneId) {
    state.activeSceneId = collection.scenes.length > 0 ? collection.scenes[0].id : '';
  }
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, message: 'Scene deleted.' });
});

// 6. Upload media files / playlists
app.post('/api/upload', upload.array('mediaFiles', 50), (req, res) => {
  const { collectionId, sceneId, sourceName, isPlaylist, transition, transitionDuration, imageDuration, aspectRatioMode, playlistQueue } = req.body;
  if (!collectionId || !sceneId) {
    return res.status(400).json({ error: 'Collection ID and Scene ID are required.' });
  }

  const collection = state.collections.find(c => c.id === collectionId);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  collection.sources = collection.sources || [];
  collection.fonts = collection.fonts || [];

  // Parse queue
  let queue = [];
  if (playlistQueue) {
    try {
      queue = JSON.parse(playlistQueue);
    } catch (e) {
      console.error('Failed to parse playlistQueue:', e);
    }
  }

  // Check if we have any files at all (either newly uploaded or existing in the queue)
  const hasUploadedFiles = req.files && req.files.length > 0;
  const hasQueue = queue.length > 0;

  if (!hasUploadedFiles && !hasQueue) {
    return res.status(400).json({ error: 'No media files provided.' });
  }

  // Resolve all files in the queue
  let playlistFiles = [];
  if (hasQueue) {
    playlistFiles = queue.map(item => {
      if (item.url) {
        // Reuse already uploaded file
        return {
          name: item.name,
          url: item.url
        };
      } else if (hasUploadedFiles && item.originalIndex !== undefined) {
        const file = req.files[item.originalIndex];
        if (file) {
          return {
            name: file.originalname,
            url: `/uploads/${collectionId}/${file.filename}`
          };
        }
      }
      return null;
    }).filter(Boolean);
  } else if (hasUploadedFiles) {
    // Fallback if no queue was sent
    playlistFiles = req.files.map(file => ({
      name: file.originalname,
      url: `/uploads/${collectionId}/${file.filename}`
    }));
  }

  if (playlistFiles.length === 0) {
    return res.status(400).json({ error: 'No valid media files resolved.' });
  }

  // Determine type (from the first resolved file)
  const firstResolved = playlistFiles[0];
  const ext = path.extname(firstResolved.name).toLowerCase();
  let type = 'image';
  if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) {
    type = 'video';
  } else if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) {
    type = 'audio';
  }

  const masterSourceId = `src_${uuidv4().substring(0, 8)}`;
  let masterSource = null;
  const makePlaylistVal = isPlaylist === 'true' || isPlaylist === true;

  if (makePlaylistVal) {
    masterSource = {
      id: masterSourceId,
      name: sourceName || `${type} playlist 1`,
      type: type,
      isPlaylist: true,
      playlistFiles: playlistFiles,
      aspectRatioMode: aspectRatioMode || 'crop',
      transition: transition || 'cut',
      transitionDuration: parseInt(transitionDuration) || 300,
      imageDuration: parseInt(imageDuration) || 5,
      visible: true
    };

    if (type === 'video' || type === 'audio') {
      masterSource.volume = 1.0;
      masterSource.loop = (type === 'audio');
    }
  } else {
    // Single file
    masterSource = {
      id: masterSourceId,
      name: sourceName || firstResolved.name,
      type: type,
      url: firstResolved.url,
      visible: true,
      aspectRatioMode: aspectRatioMode || 'crop',
      manualLayout: { scale: 1.0, x: 0, y: 0 }
    };

    if (type === 'video' || type === 'audio') {
      masterSource.volume = 1.0;
      masterSource.loop = (type === 'audio');
    }
  }

  collection.sources.push(masterSource);

  // Create scene-level layer
  const layerId = `layer_${uuidv4().substring(0, 8)}`;
  const newLayer = {
    id: layerId,
    sourceId: masterSource.id,
    name: masterSource.name,
    type: masterSource.type,
    visible: true,
    url: masterSource.url || '',
    isPlaylist: masterSource.isPlaylist || false,
    playlistFiles: masterSource.playlistFiles || [],
    aspectRatioMode: masterSource.aspectRatioMode || 'crop',
    manualLayout: masterSource.manualLayout || { scale: 1.0, x: 0, y: 0 },
    transition: masterSource.transition || 'cut',
    transitionDuration: masterSource.transitionDuration || 300,
    imageDuration: masterSource.imageDuration || 5
  };

  if (type === 'video' || type === 'audio') {
    newLayer.volume = masterSource.volume || 1.0;
    newLayer.loop = masterSource.loop || false;
  }

  scene.sources.push(newLayer);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newLayer);
});

// 6.2. Add a Custom Typography Font file to the library
app.post('/api/collections/:id/fonts', fontUpload.single('fontFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No font file provided.' });
  const { id } = req.params;
  const { fontName } = req.body;
  if (!fontName) return res.status(400).json({ error: 'Font name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.fonts = collection.fonts || [];

  const fontId = `font_${uuidv4().substring(0, 8)}`;
  const relativeUrl = `/uploads/_fonts/${req.file.filename}`;

  const newFont = {
    id: fontId,
    name: fontName,
    url: relativeUrl,
    filename: req.file.filename
  };

  collection.fonts.push(newFont);

  // Write to master source list so it populates in "Manage Sources"
  collection.sources = collection.sources || [];
  collection.sources.push({
    id: fontId,
    name: fontName,
    type: 'font',
    url: relativeUrl,
    visible: true
  });

  saveState();
  io.emit('state-updated', state);
  res.status(201).json(newFont);
});

// 6.4. Get all Master sources in a collection library
app.get('/api/collections/:id/sources', (req, res) => {
  const { id } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });
  res.json(collection.sources || []);
});

// 6.5. Add an existing collection asset source as a scene layer
app.post('/api/collections/:id/scenes/:sceneId/layers', (req, res) => {
  const { id, sceneId } = req.params;
  const { sourceId, name } = req.body;
  if (!sourceId) return res.status(400).json({ error: 'Source ID is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const master = collection.sources.find(s => s.id === sourceId);
  if (!master) return res.status(404).json({ error: 'Master source not found.' });

  const layerId = `layer_${uuidv4().substring(0, 8)}`;
  const newLayer = {
    id: layerId,
    sourceId: master.id,
    name: name || master.name,
    type: master.type,
    visible: true,
    url: master.url || '',
    isPlaylist: master.isPlaylist || false,
    playlistFiles: master.playlistFiles || [],
    aspectRatioMode: master.aspectRatioMode || 'crop',
    manualLayout: master.manualLayout || { scale: 1.0, x: 0, y: 0 },
    transition: master.transition || 'cut',
    transitionDuration: master.transitionDuration || 300,
    imageDuration: master.imageDuration || 5
  };

  if (master.type === 'video' || master.type === 'audio') {
    newLayer.volume = master.volume !== undefined ? master.volume : 1.0;
    newLayer.loop = master.loop !== undefined ? master.loop : false;
  }

  if (master.type === 'text') {
    newLayer.content = master.content;
    newLayer.style = master.style;
  }

  scene.sources.push(newLayer);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newLayer);
});

// Fallback compatibility endpoint for old control UI files
app.post('/api/collections/:id/scenes/:sceneId/sources/existing', (req, res) => {
  const { id, sceneId } = req.params;
  const { filename, name, type } = req.body;
  if (!filename || !type) return res.status(400).json({ error: 'Filename and Type are required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.sources = collection.sources || [];
  let master = collection.sources.find(s => s.url === `/uploads/${id}/${filename}`);
  
  if (!master) {
    const masterId = `src_${uuidv4().substring(0, 8)}`;
    master = {
      id: masterId,
      name: name || filename,
      type: type,
      url: `/uploads/${id}/${filename}`,
      visible: true,
      aspectRatioMode: 'crop',
      manualLayout: { scale: 1.0, x: 0, y: 0 }
    };
    collection.sources.push(master);
  }

  const layerId = `layer_${uuidv4().substring(0, 8)}`;
  const newLayer = {
    id: layerId,
    sourceId: master.id,
    name: name || master.name,
    type: master.type,
    url: master.url,
    visible: true,
    aspectRatioMode: 'crop',
    manualLayout: { scale: 1.0, x: 0, y: 0 }
  };

  if (type === 'video' || type === 'audio') {
    newLayer.volume = 1.0;
    newLayer.loop = (type === 'audio');
  }

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (scene) scene.sources.push(newLayer);
  
  saveState();
  io.emit('state-updated', state);
  res.status(201).json(newLayer);
});

// 6.6. Create a library Master Text overlay source
app.post('/api/collections/:id/sources/text', (req, res) => {
  const { id } = req.params;
  const { name, content, style, sceneId } = req.body;
  if (!content) return res.status(400).json({ error: 'Text content is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.sources = collection.sources || [];

  const masterSourceId = `src_${uuidv4().substring(0, 8)}`;
  const masterSource = {
    id: masterSourceId,
    name: name || 'Text Overlay',
    type: 'text',
    content: content,
    style: style || {
      color: '#ffffff',
      fontSize: '3rem',
      position: 'center',
      background: 'rgba(15,12,30,0.65)',
      showBackground: true,
      bgPadding: 15,
      bgOpacity: 0.65,
      showShadow: true,
      shadowColor: '#000000',
      shadowBlur: 5,
      shadowDistance: 3,
      shadowAngle: 45,
      shadowOpacity: 0.6,
      fontFamily: 'Open Sans',
      bold: false,
      italic: false,
      underline: false
    },
    visible: true
  };

  collection.sources.push(masterSource);

  // If a scene ID was passed, also add it as an active layer in that scene
  if (sceneId) {
    const scene = collection.scenes.find(s => s.id === sceneId);
    if (scene) {
      const layerId = `layer_${uuidv4().substring(0, 8)}`;
      scene.sources.push({
        id: layerId,
        sourceId: masterSource.id,
        name: masterSource.name,
        type: 'text',
        content: masterSource.content,
        style: masterSource.style,
        visible: true
      });
    }
  }

  saveState();
  io.emit('state-updated', state);
  res.status(201).json(masterSource);
});

// Old text route redirect for compatibility
app.post('/api/collections/:id/scenes/:sceneId/sources/text', (req, res) => {
  const { id, sceneId } = req.params;
  const { name, content, style } = req.body;
  
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });
  
  collection.sources = collection.sources || [];
  const masterSourceId = `src_${uuidv4().substring(0, 8)}`;
  const masterSource = {
    id: masterSourceId,
    name: name || 'Text Overlay',
    type: 'text',
    content: content,
    style: style || {
      color: '#ffffff',
      fontSize: '2rem',
      position: 'center',
      background: 'rgba(15,12,30,0.65)'
    },
    visible: true
  };
  collection.sources.push(masterSource);

  const scene = collection.scenes.find(s => s.id === sceneId);
  const layerId = `layer_${uuidv4().substring(0, 8)}`;
  const newLayer = {
    id: layerId,
    sourceId: masterSource.id,
    name: masterSource.name,
    type: 'text',
    content: masterSource.content,
    style: masterSource.style,
    visible: true
  };
  if (scene) scene.sources.push(newLayer);

  saveState();
  io.emit('state-updated', state);
  res.status(201).json(newLayer);
});

// 6.7. Create a library Master WebRTC screen share stream source
app.post('/api/collections/:id/sources/webrtc', (req, res) => {
  const { id } = req.params;
  const { name, sceneId } = req.body;

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.sources = collection.sources || [];

  const masterSourceId = `src_${uuidv4().substring(0, 8)}`;
  const masterSource = {
    id: masterSourceId,
    name: name || 'Application Window Stream',
    type: 'webrtc',
    visible: true,
    aspectRatioMode: 'crop',
    manualLayout: { scale: 1.0, x: 0, y: 0 }
  };

  collection.sources.push(masterSource);

  if (sceneId) {
    const scene = collection.scenes.find(s => s.id === sceneId);
    if (scene) {
      const layerId = `layer_${uuidv4().substring(0, 8)}`;
      scene.sources.push({
        id: layerId,
        sourceId: masterSource.id,
        name: masterSource.name,
        type: 'webrtc',
        visible: true,
        aspectRatioMode: 'crop',
        manualLayout: { scale: 1.0, x: 0, y: 0 }
      });
    }
  }

  saveState();
  io.emit('state-updated', state);
  res.status(201).json(masterSource);
});

// Old WebRTC endpoint redirect
app.post('/api/collections/:id/scenes/:sceneId/sources/webrtc', (req, res) => {
  const { id, sceneId } = req.params;
  const { name } = req.body;

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.sources = collection.sources || [];
  const masterSourceId = `src_${uuidv4().substring(0, 8)}`;
  const masterSource = {
    id: masterSourceId,
    name: name || 'Application Window Stream',
    type: 'webrtc',
    visible: true,
    aspectRatioMode: 'crop',
    manualLayout: { scale: 1.0, x: 0, y: 0 }
  };
  collection.sources.push(masterSource);

  const scene = collection.scenes.find(s => s.id === sceneId);
  const layerId = `layer_${uuidv4().substring(0, 8)}`;
  const newLayer = {
    id: layerId,
    sourceId: masterSource.id,
    name: masterSource.name,
    type: 'webrtc',
    visible: true,
    aspectRatioMode: 'crop',
    manualLayout: { scale: 1.0, x: 0, y: 0 }
  };
  if (scene) scene.sources.push(newLayer);

  saveState();
  io.emit('state-updated', state);
  res.status(201).json(newLayer);
});

// 6.8. Update a library Master Source configurations (e.g. updating playlists, names)
app.put('/api/collections/:id/sources/:sourceId', upload.array('mediaFiles', 50), (req, res) => {
  const { id, sourceId } = req.params;
  const { name, transition, transitionDuration, imageDuration, aspectRatioMode, existingFiles } = req.body;

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const master = collection.sources.find(s => s.id === sourceId);
  if (!master) return res.status(404).json({ error: 'Library Source not found.' });

  if (name) master.name = name;
  if (aspectRatioMode) master.aspectRatioMode = aspectRatioMode;
  if (transition) master.transition = transition;
  if (transitionDuration !== undefined) master.transitionDuration = parseInt(transitionDuration) || 300;
  if (imageDuration !== undefined) master.imageDuration = parseInt(imageDuration) || 5;

  if (master.isPlaylist) {
    let files = [];
    if (existingFiles) {
      try {
        files = JSON.parse(existingFiles);
      } catch (err) {
        console.error("Failed to parse existing playlist files:", err);
      }
    }

    if (req.files && req.files.length > 0) {
      req.files.forEach(f => {
        files.push({
          name: f.originalname,
          url: `/uploads/${id}/${f.filename}`
        });
      });
    }

    master.playlistFiles = files;
  }

  // Synchronize master changes to all active scenes containing layers referencing this sourceId
  collection.scenes.forEach(scene => {
    scene.sources.forEach(src => {
      if (src.sourceId === sourceId) {
        src.name = master.name;
        src.aspectRatioMode = master.aspectRatioMode;
        if (master.isPlaylist) {
          src.playlistFiles = master.playlistFiles;
          src.transition = master.transition;
          src.transitionDuration = master.transitionDuration;
          src.imageDuration = master.imageDuration;
        }
      }
    });
  });

  saveState();
  io.emit('state-updated', state);
  res.json(master);
});

// 6.9. Permanently delete a Master Source with Dependency Warnings
app.delete('/api/collections/:id/sources/:sourceId', (req, res) => {
  const { id, sourceId } = req.params;
  const force = req.query.force === 'true';

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  // 1. Scan scenes for references
  const affectedScenes = [];
  collection.scenes.forEach(scene => {
    const hasLayer = scene.sources.some(src => src.sourceId === sourceId || src.id === sourceId);
    if (hasLayer) {
      affectedScenes.push(scene.name);
    }
  });

  // 2. Fail if dependency exists and not forced
  if (affectedScenes.length > 0 && !force) {
    return res.json({
      success: false,
      requiresConfirmation: true,
      affectedScenes: affectedScenes,
      message: `Deleting this source will affect ${affectedScenes.length} scenes: ${affectedScenes.join(', ')}.`
    });
  }

  // 3. Purge master source
  const sourceIndex = collection.sources.findIndex(s => s.id === sourceId);
  let masterSource = null;
  if (sourceIndex !== -1) {
    masterSource = collection.sources[sourceIndex];
    collection.sources.splice(sourceIndex, 1);
  }

  // 4. Remove all referencing layers from scenes
  collection.scenes.forEach(scene => {
    scene.sources = scene.sources.filter(src => src.sourceId !== sourceId && src.id !== sourceId);
  });

  // 5. Delete physical files
  if (masterSource) {
    if (masterSource.isPlaylist && masterSource.playlistFiles) {
      masterSource.playlistFiles.forEach(pf => {
        const filepath = path.join(__dirname, pf.url);
        if (fs.existsSync(filepath)) {
          try { fs.unlinkSync(filepath); } catch (e) { console.error(e); }
        }
      });
    } else if (masterSource.url) {
      const filepath = path.join(__dirname, masterSource.url);
      if (fs.existsSync(filepath)) {
        try { fs.unlinkSync(filepath); } catch (e) { console.error(e); }
      }
    }
  }

  // Also remove custom fonts if matched
  if (collection.fonts) {
    const fontIdx = collection.fonts.findIndex(f => f.id === sourceId);
    if (fontIdx !== -1) {
      const font = collection.fonts[fontIdx];
      const filepath = path.join(__dirname, font.url);
      if (fs.existsSync(filepath)) {
        try { fs.unlinkSync(filepath); } catch (e) { console.error(e); }
      }
      collection.fonts.splice(fontIdx, 1);
    }
  }

  saveState();
  io.emit('state-updated', state);
  res.json({ success: true, message: 'Source assets completely purged.' });
});

// 8. Delete a scene layer (retains master library source and physical files!)
app.delete('/api/collections/:id/scenes/:sceneId/sources/:sourceId', (req, res) => {
  const { id, sceneId, sourceId } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const sourceIndex = scene.sources.findIndex(src => src.id === sourceId);
  if (sourceIndex === -1) return res.status(404).json({ error: 'Source layer not found.' });

  // Only splice from scene sources, DO NOT unlink from uploads folder!
  scene.sources.splice(sourceIndex, 1);
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, message: 'Scene layer removed.' });
});

// 9. Get uploaded files in a collection folder
app.get('/api/collections/:id/files', (req, res) => {
  const { id } = req.params;
  const dir = path.join(UPLOADS_DIR, id);
  if (!fs.existsSync(dir)) {
    return res.json([]);
  }

  try {
    const filenames = fs.readdirSync(dir);
    const files = filenames.map(name => {
      const filePath = path.join(dir, name);
      const stats = fs.statSync(filePath);

      const ext = path.extname(name).toLowerCase();
      let type = 'other';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
        type = 'image';
      } else if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) {
        type = 'video';
      } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
        type = 'audio';
      }

      return {
        name,
        url: `/uploads/${id}/${name}`,
        size: stats.size,
        type
      };
    });
    res.json(files);
  } catch (err) {
    console.error(`Failed to read directory ${dir}:`, err);
    res.status(500).json({ error: 'Failed to read directory.' });
  }
});

// 10. Duplicate a collection
app.post('/api/collections/:id/duplicate', (req, res) => {
  const { id } = req.params;
  const srcCollection = state.collections.find(c => c.id === id);
  if (!srcCollection) return res.status(404).json({ error: 'Collection not found.' });

  const newId = `coll_${uuidv4().substring(0, 8)}`;
  const newDir = getCollectionDir(newId);
  const oldDir = path.join(UPLOADS_DIR, id);

  // Copy physical files if old directory exists
  if (fs.existsSync(oldDir)) {
    try {
      const files = fs.readdirSync(oldDir);
      files.forEach(file => {
        fs.copyFileSync(path.join(oldDir, file), path.join(newDir, file));
      });
    } catch (err) {
      console.error('Failed to copy physical files during duplication:', err);
    }
  }

  const duplicatedSources = (srcCollection.sources || []).map(s => {
    let newUrl = s.url;
    if (s.url && s.url.startsWith(`/uploads/${id}/`)) {
      newUrl = s.url.replace(`/uploads/${id}/`, `/uploads/${newId}/`);
    }
    
    let playFiles = s.playlistFiles || [];
    if (s.isPlaylist) {
      playFiles = playFiles.map(f => {
        let fUrl = f.url;
        if (f.url && f.url.startsWith(`/uploads/${id}/`)) {
          fUrl = f.url.replace(`/uploads/${id}/`, `/uploads/${newId}/`);
        }
        return { ...f, url: fUrl };
      });
    }

    return { ...s, url: newUrl, playlistFiles: playFiles };
  });

  // Helper recursive mapping function to clone scenes and sources with fresh IDs
  const duplicatedScenes = srcCollection.scenes.map(oldScene => {
    const newSceneId = `scene_${uuidv4().substring(0, 8)}`;
    const duplicatedSources = oldScene.sources.map(oldSrc => {
      const newSrcId = `src_${uuidv4().substring(0, 8)}`;
      let newUrl = oldSrc.url;
      if (oldSrc.url && oldSrc.url.startsWith(`/uploads/${id}/`)) {
        newUrl = oldSrc.url.replace(`/uploads/${id}/`, `/uploads/${newId}/`);
      }
      
      let playFiles = oldSrc.playlistFiles || [];
      if (oldSrc.isPlaylist) {
        playFiles = playFiles.map(f => {
          let fUrl = f.url;
          if (f.url && f.url.startsWith(`/uploads/${id}/`)) {
            fUrl = f.url.replace(`/uploads/${id}/`, `/uploads/${newId}/`);
          }
          return { ...f, url: fUrl };
        });
      }

      return { ...oldSrc, id: newSrcId, url: newUrl, playlistFiles: playFiles };
    });

    return {
      id: newSceneId,
      name: oldScene.name,
      sources: duplicatedSources
    };
  });

  const newCollection = {
    id: newId,
    name: `${srcCollection.name} (Copy)`,
    folder: `uploads/${newId}`,
    sources: duplicatedSources,
    fonts: srcCollection.fonts || [],
    scenes: duplicatedScenes
  };

  state.collections.push(newCollection);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newCollection);
});

// 11. Rename a collection
app.put('/api/collections/:id/rename', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Collection name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  collection.name = name;
  saveState();

  io.emit('state-updated', state);
  res.json(collection);
});

// 12. Duplicate a scene
app.post('/api/collections/:id/scenes/:sceneId/duplicate', (req, res) => {
  const { id, sceneId } = req.params;
  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const srcScene = collection.scenes.find(s => s.id === sceneId);
  if (!srcScene) return res.status(404).json({ error: 'Scene not found.' });

  const newSceneId = `scene_${uuidv4().substring(0, 8)}`;

  const duplicatedSources = srcScene.sources.map(oldSrc => {
    const newSrcId = `src_${uuidv4().substring(0, 8)}`;
    return { ...oldSrc, id: newSrcId };
  });

  const newScene = {
    id: newSceneId,
    name: `${srcScene.name} (Copy)`,
    sources: duplicatedSources
  };

  collection.scenes.push(newScene);
  saveState();

  io.emit('state-updated', state);
  res.status(201).json(newScene);
});

// 13. Rename a scene
app.put('/api/collections/:id/scenes/:sceneId/rename', (req, res) => {
  const { id, sceneId } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Scene name is required.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  scene.name = name;
  saveState();

  io.emit('state-updated', state);
  res.json(scene);
});

// 14. Reorder collections
app.put('/api/collections/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array.' });

  const reordered = [];
  order.forEach(colId => {
    const col = state.collections.find(c => c.id === colId);
    if (col) reordered.push(col);
  });

  state.collections.forEach(col => {
    if (!reordered.find(c => c.id === col.id)) {
      reordered.push(col);
    }
  });

  state.collections = reordered;
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, collections: state.collections });
});

// 15. Reorder scenes
app.put('/api/collections/:id/scenes/reorder', (req, res) => {
  const { id } = req.params;
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const reordered = [];
  order.forEach(scId => {
    const sc = collection.scenes.find(s => s.id === scId);
    if (sc) reordered.push(sc);
  });

  collection.scenes.forEach(sc => {
    if (!reordered.find(s => s.id === sc.id)) {
      reordered.push(sc);
    }
  });

  collection.scenes = reordered;
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, scenes: collection.scenes });
});

// 16. Reorder sources
app.put('/api/collections/:id/scenes/:sceneId/sources/reorder', (req, res) => {
  const { id, sceneId } = req.params;
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array.' });

  const collection = state.collections.find(c => c.id === id);
  if (!collection) return res.status(404).json({ error: 'Collection not found.' });

  const scene = collection.scenes.find(s => s.id === sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found.' });

  const reordered = [];
  order.forEach(srcId => {
    const src = scene.sources.find(s => s.id === srcId);
    if (src) reordered.push(src);
  });

  scene.sources.forEach(src => {
    if (!reordered.find(s => s.id === src.id)) {
      reordered.push(src);
    }
  });

  scene.sources = reordered;
  saveState();

  io.emit('state-updated', state);
  res.json({ success: true, sources: scene.sources });
});


// Real-Time Socket Connection Handlers
let clients = new Set();
let displayStatus = { active: false, width: 0, height: 0, fullscreen: false };

io.on('connection', (socket) => {
  console.log(`New WebSocket connection established (ID: ${socket.id})`);
  clients.add(socket);

  // WebRTC signaling routing bridge
  socket.on('webrtc-signaling', (data) => {
    socket.broadcast.emit('webrtc-signaling', data);
  });

  // Send state immediately on connection
  socket.emit('sync-state', {
    state,
    displayStatus
  });

  // Client registration
  socket.on('register-client', (data) => {
    socket.role = data.role;
    console.log(`Client ${socket.id} registered as role: "${data.role}"`);
    if (data.role === 'display') {
      displayStatus.active = true;
      io.emit('display-status-updated', displayStatus);
    }
  });

  // Switch active Collection
  socket.on('change-collection', (data) => {
    const { collectionId } = data;
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      state.activeCollectionId = collectionId;
      state.activeSceneId = collection.scenes.length > 0 ? collection.scenes[0].id : '';
      saveState();
      io.emit('collection-changed', {
        activeCollectionId: state.activeCollectionId,
        activeSceneId: state.activeSceneId,
        state
      });
      console.log(`Switched active collection to: ${collection.name} (${collectionId})`);
    }
  });

  // Switch active Scene
  socket.on('change-scene', (data) => {
    const { sceneId } = data;
    state.activeSceneId = sceneId;
    saveState();
    io.emit('scene-changed', { activeSceneId: sceneId });
    console.log(`Switched active scene to ID: ${sceneId}`);
  });

  // Real-time source control (Volume, Loop, Visible toggle, nested style, and positioning)
  socket.on('control-source', (data) => {
    const { collectionId, sceneId, sourceId, property, value } = data;

    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const scene = collection.scenes.find(s => s.id === sceneId);
      if (scene) {
        const source = scene.sources.find(src => src.id === sourceId);
        if (source) {
          // Dynamic nested assignment helpers
          if (property.startsWith('style.')) {
            const styleProp = property.split('.')[1];
            source.style = source.style || {};
            source.style[styleProp] = value;
          } else if (property.startsWith('manualLayout.')) {
            const layoutProp = property.split('.')[1];
            source.manualLayout = source.manualLayout || { scale: 1.0, x: 0, y: 0 };
            source.manualLayout[layoutProp] = value;
          } else {
            source[property] = value;
          }
          
          saveState();

          // Broadcast delta change to other screens
          io.emit('source-controlled', { collectionId, sceneId, sourceId, property, value });
          console.log(`Source control: Source ${sourceId} property "${property}" updated to ${value}`);
        }
      }
    }
  });

  // Real-time text content updates
  socket.on('update-text-content', (data) => {
    const { collectionId, sceneId, sourceId, content } = data;
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      const scene = collection.scenes.find(s => s.id === sceneId);
      if (scene) {
        const source = scene.sources.find(src => src.id === sourceId);
        if (source && source.type === 'text') {
          source.content = content;
          saveState();
          io.emit('text-content-updated', { sourceId, content });
        }
      }
    }
  });

  // Report Display Window Screen status
  socket.on('display-status', (data) => {
    displayStatus = { ...displayStatus, ...data };
    io.emit('display-status-updated', displayStatus);
    console.log('Showing screen status updated:', displayStatus);
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    clients.delete(socket);
    console.log(`WebSocket client disconnected (ID: ${socket.id})`);
    if (socket.role === 'display') {
      let displayExists = false;
      for (let s of io.sockets.sockets.values()) {
        if (s.role === 'display') displayExists = true;
      }
      if (!displayExists) {
        displayStatus.active = false;
        io.emit('display-status-updated', displayStatus);
        console.log('All fullscreen showing display pages disconnected.');
      }
    }
  });
});

// Resolve local network IP address
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  return addresses;
}

// Boot Server
server.listen(PORT, () => {
  console.log('\n======================================================');
  console.log(`🚀 ScreenSwitching Server running on port ${PORT}`);
  console.log(`💻 Local Control Panel: http://localhost:${PORT}/control.html`);
  console.log(`📺 Fullscreen Output Screen: http://localhost:${PORT}/display.html`);

  const localIPs = getLocalIPs();
  if (localIPs.length > 0) {
    const remoteUrl = `http://${localIPs[0]}:${PORT}/remote.html`;
    console.log('\n📱 Smartphone Remote Control URL:');
    console.log(`👉 ${remoteUrl}`);

    if (qrcodeTerminal) {
      console.log('\nScan this QR code with your phone to remote control:');
      qrcodeTerminal.generate(remoteUrl, { small: true });
    }
  } else {
    console.log('📱 Smartphone Remote Control URL: Connect device to local network');
  }
  console.log('======================================================\n');
});
