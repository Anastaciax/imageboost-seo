// scripts/compress.js
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

const inputDir = path.resolve('./uploads');
const outputDir = path.resolve('./optimized');

async function compressAllImages() {
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const files = await fs.readdir(inputDir);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const inPath = path.join(inputDir, file);
      const outPath = path.join(outputDir, file);

      try {
        if (ext === '.jpg' || ext === '.jpeg') {
          await sharp(inPath).jpeg({ quality: 80 }).toFile(outPath);
        } else if (ext === '.png') {
          await sharp(inPath).png({ compressionLevel: 9 }).toFile(outPath);
        } else if (ext === '.webp') {
          await sharp(inPath).webp({ quality: 80 }).toFile(outPath.replace(/\.(jpg|jpeg|png)$/i, '.webp'));
        } else {
          console.log(`Skipping unsupported file: ${file}`);
          continue;
        }
        console.log(`✔ Compressed ${file}`);
      } catch (error) {
        console.error(`Error processing ${file}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error during compression:', error);
    process.exit(1);
  }
}

compressAllImages().catch(err => {
  console.error('Compression error:', err);
  process.exit(1);
});
