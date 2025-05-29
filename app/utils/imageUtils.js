import fs from 'fs/promises';
import path from 'path';

const OPTIMIZED_IMAGES_DIR = path.resolve('./optimized');

export async function getOptimizedImages(page = 1, perPage = 15) {
  try {
    // Read the optimized directory
    const files = await fs.readdir(OPTIMIZED_IMAGES_DIR);
    
    // Filter for image files
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    });

    // Calculate pagination
    const totalImages = imageFiles.length;
    const totalPages = Math.ceil(totalImages / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedImages = imageFiles.slice(startIndex, startIndex + perPage);

    // Create image objects with full paths
    const images = await Promise.all(paginatedImages.map(async (filename) => {
      const filePath = path.join(OPTIMIZED_IMAGES_DIR, filename);
      try {
        const stats = await fs.stat(filePath);
        return {
          filename,
          path: `/optimized/${filename}`,
          originalPath: `/uploads/${filename}`,
          size: stats.size,
          lastModified: stats.mtime
        };
      } catch (error) {
        console.error(`Error getting stats for ${filename}:`, error);
        return null;
      }
    }));

    // Filter out any null values from failed stat calls
    const validImages = images.filter(Boolean);

    return {
      images: validImages,
      pagination: {
        currentPage: page,
        perPage,
        total: totalImages,
        totalPages
      }
    };
  } catch (error) {
    console.error('Error reading optimized images:', error);
    return {
      images: [],
      pagination: {
        currentPage: 1,
        perPage: 15,
        total: 0,
        totalPages: 0
      }
    };
  }
}

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
