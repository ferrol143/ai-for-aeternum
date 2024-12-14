import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import dotenv from 'dotenv';

dotenv.config();

class DocumentAnalyzer {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.SECRET_KEY_GENERATIVE_AI);
        this.imageModel = this.genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash" 
        });
        this.textModel = this.genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro" 
        });
    }

    #getMimeType(filePath) {
        const extension = path.extname(filePath).toLowerCase().slice(1);
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'webp': 'image/webp',
            'pdf': 'application/pdf'
        };
        return mimeTypes[extension] || 'application/octet-stream';
    }

    #resolveFilePath(filePath) {
        return path.isAbsolute(filePath) 
            ? filePath 
            : path.resolve(process.cwd(), filePath);
    }

    async #safeReadFile(filePath) {
        const resolvedPath = this.#resolveFilePath(filePath);
        
        try {
            await fs.promises.access(resolvedPath, fs.constants.R_OK);
            return await fs.promises.readFile(resolvedPath);
        } catch (error) {
            console.error(`File Access Error: ${resolvedPath}`, error);
            throw new Error(`Cannot read file: ${resolvedPath}. ${error.message}`);
        }
    }

    async #extractPDFText(pdfBuffer) {
        try {
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            const pageCount = pdfDoc.getPageCount();
            let fullText = '';

            for (let i = 0; i < pageCount; i++) {
                const page = pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                
                const pageText = textContent.items
                    .map(item => item.text || '')
                    .join(' ')
                    .trim();

                fullText += pageText + '\n';
            }

            return fullText.trim();
        } catch (error) {
            console.error("PDF Text Extraction Error:", error);
            throw new Error('Failed to extract PDF text');
        }
    }

    async #optimizeImage(imagePath, maxSize = 1024) {
        try {
            const resolvedPath = this.#resolveFilePath(imagePath);
            return await sharp(resolvedPath)
                .resize(maxSize, maxSize, { 
                    fit: 'inside', 
                    withoutEnlargement: true 
                })
                .toBuffer();
        } catch (error) {
            console.error("Image Optimization Error:", error);
            throw error;
        }
    }

    async #analyzeWithGemini(model, prompt, imageData = null) {
        try {
            // Specific handling for image analysis
            if (imageData) {
                const result = await model.generateContent({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { 
                                inlineData: { 
                                    mimeType: imageData.mimeType || 'image/jpeg', 
                                    data: imageData.base64 
                                }
                            }
                        ]
                    }]
                });
                return result.response.text();
            }

            // Text-only analysis
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error("Gemini Analysis Error:", error);
            
            // Enhanced error handling
            if (error.message.includes('deprecated') || error.message.includes('404 Not Found')) {
                console.warn('Switching to alternative Gemini model');
                
                // Fallback to alternative model
                const fallbackModel = this.genAI.getGenerativeModel({ 
                    model: "gemini-1.5-flash" 
                });
                
                try {
                    if (imageData) {
                        const result = await fallbackModel.generateContent({
                            contents: [{
                                parts: [
                                    { text: prompt },
                                    { 
                                        inlineData: { 
                                            mimeType: imageData.mimeType || 'image/jpeg', 
                                            data: imageData.base64 
                                        }
                                    }
                                ]
                            }]
                        });
                        return result.response.text();
                    } else {
                        const result = await fallbackModel.generateContent(prompt);
                        return result.response.text();
                    }
                } catch (fallbackError) {
                    console.error("Fallback Model Error:", fallbackError);
                    throw fallbackError;
                }
            }
            
            throw error;
        }
    }

    async preprocessImage(imagePath) {
        const optimizedImage = await this.#optimizeImage(imagePath);
        
        return this.#analyzeWithGemini(
            this.imageModel,
            "Comprehensively analyze this image. Extract all visible text, describe content, identify key elements, and provide detailed insights.",
            {
                mimeType: this.#getMimeType(imagePath),
                base64: optimizedImage.toString('base64')
            }
        );
    }

    async extractPDFContent(pdfPath) {
        try {
            const pdfBuffer = await this.#safeReadFile(pdfPath);
            const pdfText = await this.#extractPDFText(pdfBuffer);

            return this.#analyzeWithGemini(
                this.textModel,
                `Comprehensively analyze this PDF text. Extract key information, summarize content, identify important details, and provide structured insights:${pdfText}`
            );
        } catch (error) {
            console.error("PDF Extraction Error:", error);
            return null;
        }
    }

    async extractImageText(imagePath) {
        const optimizedImage = await this.#optimizeImage(imagePath);
        
        const extractionPrompt = `
        Extract structured information from this image. 
        Provide the details in a JSON format with the following keys:
        - recipientName: Full name of the recipient
        - eventTitle: Title of the event or seminar
        - eventDate: Date of the event
        - description: Detailed description of the achievement
        - issuedBy: Organization or institution issuing the certificate
        - additionalNotes: Any additional relevant information
    
        Format the response as a clean, parseable JSON object. 
        If any information is missing, use null for that field.
        `;
        
        const result = await this.#analyzeWithGemini(
            this.imageModel,
            extractionPrompt,
            {
                mimeType: this.#getMimeType(imagePath),
                base64: optimizedImage.toString('base64')
            }
        );
    
        try {
            const parsedResult = JSON.parse(result.replace(/```json|```/g, '').trim());
            return parsedResult;
        } catch (error) {
            console.error("JSON Parsing Error:", error);
            return {
                extractedText: result,
                error: "Failed to parse structured data"
            };
        }
    }
    
    processExtractedData(extractedData) {
        const processedData = {
            labels: {
                recipientName: "Nama Penerima",
                eventTitle: "Judul Acara",
                eventDate: "Tanggal Acara",
                description: "Deskripsi",
                issuedBy: "Dikeluarkan Oleh"
            },
            values: extractedData
        };
    
        return processedData;
    }

    async processDocument(filePath) {
        const fileType = this.detectFileType(filePath);
    
        const processingMap = {
            'image': async (path) => {
                const extractedData = await this.extractImageText(path);
                return this.processExtractedData(extractedData);
            },
            'pdf': this.extractPDFContent
        };
    
        const processor = processingMap[fileType];
        if (!processor) throw new Error('Unsupported file type');
    
        return await processor.call(this, filePath);
    }

    detectFileType(filePath) {
        const extension = path.extname(filePath).toLowerCase().slice(1);
        const fileTypes = {
            images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'],
            pdfs: ['pdf']
        };

        if (fileTypes.images.includes(extension)) return 'image';
        if (fileTypes.pdfs.includes(extension)) return 'pdf';
        return 'unknown';
    }

    cleanExtractedText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s .,!?-]/g, '')
            .trim();
    }

    async processBatch(filePaths) {
        return Promise.all(
            filePaths.map(async (filePath) => {
                try { return {
                        filePath,
                        content: await this.processDocument(filePath)
                    };
                } catch (error) {
                    return {
                        filePath,
                        error: error.message
                    };
                }
            })
        );
    }
}

export default DocumentAnalyzer;