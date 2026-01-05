const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Configuration de Multer pour les images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Connexion à MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/thec-tic-g', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connecté à MongoDB Atlas'))
.catch(err => console.error('❌ Erreur de connexion MongoDB:', err));

// Schémas Mongoose
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const ShelfSchema = new mongoose.Schema({
  name: { type: String, required: true },
  row: { type: String, required: true },
  number: { type: Number, required: true },
  color: { type: String, default: '#3b82f6' },
  positions: [{
    positionId: String,
    level: String,
    positionNumber: Number,
    occupied: { type: Boolean, default: false },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' }
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const MaterialSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String },
  entryDate: { type: Date, required: true },
  condition: { type: Number, required: true, min: 0, max: 100 }, // 0-100%
  state: { type: String, default: 'good' }, // good, warning, bad
  shelf: { type: String, required: true },
  shelfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelf' },
  position: { type: String, required: true },
  color: { type: String, default: '#3b82f6' },
  image: { type: String },
  notes: { type: String },
  lastInspection: { type: Date },
  nextInspection: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const InspectionSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  materials: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
  inspector: { type: String, required: true },
  type: { type: String, default: 'hebdomadaire' },
  status: { type: String, default: 'planned' },
  result: { type: String },
  notes: { type: String },
  report: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Modèles
const User = mongoose.model('User', UserSchema);
const Shelf = mongoose.model('Shelf', ShelfSchema);
const Material = mongoose.model('Material', MaterialSchema);
const Inspection = mongoose.model('Inspection', InspectionSchema);

// Routes API

// 1. Authentification (simplifiée pour l'exemple)
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const user = new User({ username, email, password });
    await user.save();
    res.status(201).json({ message: 'Utilisateur créé', user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    res.json({ message: 'Connexion réussie', user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 2. Gestion des étagères
app.post('/api/shelves', async (req, res) => {
  try {
    const { name, row, number, color } = req.body;
    
    // Vérifier si l'étagère existe déjà
    const existingShelf = await Shelf.findOne({ row, number });
    if (existingShelf) {
      return res.status(400).json({ error: 'Cette étagère existe déjà' });
    }
    
    // Créer les positions (3 niveaux x 3 positions)
    const positions = [];
    const levels = ['H', 'M', 'B']; // Haut, Milieu, Bas
    
    levels.forEach((level, levelIndex) => {
      for (let i = 1; i <= 3; i++) {
        positions.push({
          positionId: `${row}${number}-${level}${i}`,
          level: level === 'H' ? 'Haut' : level === 'M' ? 'Milieu' : 'Bas',
          positionNumber: i,
          occupied: false
        });
      }
    });
    
    const shelf = new Shelf({
      name,
      row,
      number,
      color,
      positions
    });
    
    await shelf.save();
    res.status(201).json(shelf);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/shelves', async (req, res) => {
  try {
    const shelves = await Shelf.find().sort({ row: 1, number: 1 });
    res.json(shelves);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/shelves/:id', async (req, res) => {
  try {
    await Shelf.findByIdAndDelete(req.params.id);
    res.json({ message: 'Étagère supprimée' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 3. Gestion des matériels
app.post('/api/materials', upload.single('image'), async (req, res) => {
  try {
    const materialData = req.body;
    
    if (req.file) {
      materialData.image = `/uploads/${req.file.filename}`;
    }
    
    // Mettre à jour l'état basé sur la condition (0-100%)
    if (materialData.condition >= 80) {
      materialData.state = 'good';
    } else if (materialData.condition >= 40) {
      materialData.state = 'warning';
    } else {
      materialData.state = 'bad';
    }
    
    const material = new Material(materialData);
    await material.save();
    
    // Mettre à jour la position dans l'étagère
    if (material.shelfId) {
      await Shelf.findByIdAndUpdate(material.shelfId, {
        $set: { "positions.$[pos].occupied": true, "positions.$[pos].materialId": material._id }
      }, {
        arrayFilters: [{ "pos.positionId": material.position }]
      });
    }
    
    res.status(201).json(material);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/materials', async (req, res) => {
  try {
    const { search, category, state, shelf, minCondition, maxCondition } = req.query;
    let query = {};
    
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (category) {
      query.category = category;
    }
    if (state) {
      query.state = state;
    }
    if (shelf) {
      query.shelf = shelf;
    }
    if (minCondition || maxCondition) {
      query.condition = {};
      if (minCondition) query.condition.$gte = parseInt(minCondition);
      if (maxCondition) query.condition.$lte = parseInt(maxCondition);
    }
    
    const materials = await Material.find(query)
      .populate('shelfId')
      .sort({ createdAt: -1 });
    
    res.json(materials);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/materials/:id', async (req, res) => {
  try {
    const material = await Material.findById(req.params.id).populate('shelfId');
    if (!material) {
      return res.status(404).json({ error: 'Matériel non trouvé' });
    }
    res.json(material);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/materials/:id', upload.single('image'), async (req, res) => {
  try {
    const updateData = req.body;
    
    if (req.file) {
      updateData.image = `/uploads/${req.file.filename}`;
    }
    
    // Mettre à jour l'état basé sur la condition
    if (updateData.condition) {
      const condition = parseInt(updateData.condition);
      if (condition >= 80) {
        updateData.state = 'good';
      } else if (condition >= 40) {
        updateData.state = 'warning';
      } else {
        updateData.state = 'bad';
      }
    }
    
    const material = await Material.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('shelfId');
    
    res.json(material);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/materials/:id', async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    
    if (material.shelfId) {
      // Libérer la position dans l'étagère
      await Shelf.findByIdAndUpdate(material.shelfId, {
        $set: { "positions.$[pos].occupied": false, "positions.$[pos].materialId": null }
      }, {
        arrayFilters: [{ "pos.positionId": material.position }]
      });
    }
    
    await Material.findByIdAndDelete(req.params.id);
    res.json({ message: 'Matériel supprimé' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 4. Gestion des inspections
app.post('/api/inspections', async (req, res) => {
  try {
    const inspection = new Inspection(req.body);
    await inspection.save();
    
    // Mettre à jour la date de dernière inspection des matériels
    await Material.updateMany(
      { _id: { $in: inspection.materials } },
      { lastInspection: inspection.date }
    );
    
    res.status(201).json(inspection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/inspections', async (req, res) => {
  try {
    const inspections = await Inspection.find()
      .populate('materials')
      .sort({ date: -1 });
    res.json(inspections);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 5. Statistiques
app.get('/api/stats', async (req, res) => {
  try {
    const totalMaterials = await Material.countDocuments();
    const goodMaterials = await Material.countDocuments({ state: 'good' });
    const warningMaterials = await Material.countDocuments({ state: 'warning' });
    const badMaterials = await Material.countDocuments({ state: 'bad' });
    
    const totalShelves = await Shelf.countDocuments();
    const occupiedPositions = await Shelf.aggregate([
      { $unwind: '$positions' },
      { $match: { 'positions.occupied': true } },
      { $count: 'occupied' }
    ]);
    
    const categoryStats = await Material.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    
    res.json({
      totalMaterials,
      goodMaterials,
      warningMaterials,
      badMaterials,
      totalShelves,
      occupiedPositions: occupiedPositions[0]?.occupied || 0,
      categoryStats,
      conditionAverage: await Material.aggregate([
        { $group: { _id: null, avg: { $avg: '$condition' } } }
      ])
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
});
