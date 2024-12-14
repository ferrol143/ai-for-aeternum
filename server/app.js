import express from 'express';
import cors from "cors";
import { upload } from './config/upload.js';
import DocumentAnalyzer from './controllers/documentController.js';

const app = express();
const port = 3000;

app.use(cors());

app.post('/upload-single', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const analyzer = new DocumentAnalyzer();
  const result = await analyzer.processDocument(req.file.path);

  res.json({
      message: 'File analyze successfully',
      filename: req.file.filename,
      path: req.file.path,
      result
  });
});

app.post('/upload-multiple', upload.array('files', 5), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No files uploaded.');
  }
  
  const uploadedFiles = req.files.map(file => ({
    filename: file.filename,
    path: file.path
  }));
  
  res.json({
    message: 'Files uploaded successfully',
    files: uploadedFiles
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({
    error: 'Something went wrong',
    message: err.message
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});