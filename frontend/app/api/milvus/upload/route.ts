import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';
import { milvus, COLLECTION_NAME, VECTOR_FIELD_NAME } from '@/app/utils/milvus';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';

// For embedding generation in server
import { AutoProcessor, RawImage, CLIPVisionModelWithProjection, env } from "@xenova/transformers";

// Configure a writable cache directory in tmp (works in Vercel)
const tmpDir = os.tmpdir();
env.cacheDir = path.join(tmpDir, '.cache', 'transformers');
console.log("Using cache directory:", env.cacheDir);

// Create cache directory if it doesn't exist
try {
  if (!fs.existsSync(env.cacheDir)) {
    fs.mkdirSync(env.cacheDir, { recursive: true });
  }
} catch (err) {
  console.warn("Failed to create cache directory:", err);
}

// IMPORTANT: Use Node.js runtime, not Edge runtime
export const runtime = "nodejs"; 
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Define maximum image dimensions to reduce memory usage
const MAX_IMAGE_SIZE = 512; // pixels

// Pre-load model and processor (will be cached)
let processor: any = null;
let vision_model: any = null;

// Smaller model with lower memory footprint
const model_id = "Xenova/clip-vit-base-patch32";

// Function to resize image buffer to reduce memory usage
async function resizeImageBuffer(buffer: ArrayBuffer, mimeType: string): Promise<Buffer> {
  try {
    // Convert ArrayBuffer to Buffer
    const inputBuffer = Buffer.from(buffer);
    
    // Use sharp to resize the image while maintaining aspect ratio
    const resizedBuffer = await sharp(inputBuffer)
      .resize({
        width: MAX_IMAGE_SIZE,
        height: MAX_IMAGE_SIZE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .toBuffer();
    
    return resizedBuffer;
  } catch (error) {
    console.error("Error resizing image:", error);
    // Return original buffer if resize fails
    return Buffer.from(buffer);
  }
}

export async function POST(req: NextRequest) {
  console.log("Upload API called - Method:", req.method);
  let fileName = "";
  
  try {
    // Get cookie store
    const cookieStore = cookies();
    
    // 1. Get authenticated user
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.log("Unauthorized - no session");
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 2. Parse the form data
    const formData = await req.formData();
    const title = formData.get('title') as string;
    const description = formData.get('description') as string || '';
    const location = formData.get('location') as string;
    const image = formData.get('image') as File;
    
    if (!title || !location || !image) {
      console.log("Missing required fields");
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log("Processing upload for user:", session.user.email);
    console.log("Image size:", image.size, "bytes");
    
    // 3. Generate a unique ID for the item
    const itemId = uuidv4();
    
    // 4. Upload image to Supabase Storage
    const imageBuffer = await image.arrayBuffer();
    const imageBytes = new Uint8Array(imageBuffer);
    
    fileName = `${itemId}-${image.name.replace(/\s/g, '_')}`;
    console.log("Uploading to Supabase Storage:", fileName);
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('item-images')
      .upload(fileName, imageBytes);
    
    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return new Response(JSON.stringify({ error: 'Failed to upload image: ' + uploadError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log("File uploaded successfully to Supabase");
    
    // 5. Get the public URL for the uploaded image
    const { data: urlData } = supabase.storage
      .from('item-images')
      .getPublicUrl(fileName);
    
    const imageUrl = urlData?.publicUrl;
    console.log("Image public URL:", imageUrl);
    
    // 6. Generate image embedding
    try {
      console.log("Initializing image processor with cache dir:", env.cacheDir);
      
      // Use a more flexible cache strategy
      env.cacheDir = process.env.VERCEL_TMP_DIR || path.join(os.tmpdir(), '.cache', 'transformers');
      env.allowRemoteModels = true;
      process.env.TRANSFORMERS_OFFLINE = '0';
      
      // Resize the image to reduce memory usage
      const resizedImageBuffer = await resizeImageBuffer(imageBuffer, image.type);
      console.log(`Image resized from ${imageBuffer.byteLength} to ${resizedImageBuffer.length} bytes`);
      
      // Load processor and model if not already loaded
      if (!processor) {
        processor = await AutoProcessor.from_pretrained(model_id, {
          cache_dir: env.cacheDir,
          local_files_only: false,
        });
      }
      console.log("Processor loaded, initializing vision model");
      
      if (!vision_model) {
        vision_model = await CLIPVisionModelWithProjection.from_pretrained(model_id, {
          cache_dir: env.cacheDir,
          local_files_only: false,
          quantized: true, // Use quantized model to reduce memory usage
        });
      }
      
      console.log("Vision model loaded, processing image");

      let image_obj;
      try {
        // Try to use the resized buffer directly
        image_obj = await RawImage.fromBlob(new Blob([resizedImageBuffer], { type: image.type || 'image/jpeg' }));
      } catch (e) {
        console.log("Falling back to base64 method for image loading");
        // Fallback: Convert to base64 and use that
        const base64 = Buffer.from(resizedImageBuffer).toString('base64');
        const dataUrl = `data:${image.type || 'image/jpeg'};base64,${base64}`;
        image_obj = await RawImage.fromBlob(await (await fetch(dataUrl)).blob());
      }
    
      console.log("Image obj created");
         
      const image_inputs = await processor(image_obj);
      console.log("Image processed");
      
      const { image_embeds } = await vision_model(image_inputs);
      console.log("Image embedding generated");
      
      const imageVector = image_embeds.tolist()[0];
      
      // 7. Insert into Milvus
      console.log("Inserting into Milvus");
      await milvus.insert({
        collection_name: COLLECTION_NAME,
        fields_data: [{
          [VECTOR_FIELD_NAME]: imageVector,
          imageId: itemId,
          url: imageUrl,
          aiDescription: title,
          photoDescription: description || "",
          location: location,
          submitter_email: session.user.email,
          created_at: new Date().toISOString(),
          blurHash: "",
          ratio: 1.0, // Default aspect ratio
        }],
      });
      
      console.log("Milvus insert successful");
      
      // Return success response
      return new Response(JSON.stringify({
        success: true,
        item: {
          id: itemId,
          title,
          description,
          location,
          submitter_email: session.user.email,
          created_at: new Date().toISOString(),
          item_images: [{
            image_url: imageUrl
          }],
          profiles: {
            email: session.user.email
          }
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (processingError) {
      console.error("Error in image processing or Milvus insertion:", processingError);
      
      // Cleanup
      try {
        console.log("Cleaning up Supabase Storage file due to error");
        await supabase.storage.from('item-images').remove([fileName]);
      } catch (cleanupError) {
        console.error("Failed to clean up file:", cleanupError);
      }
      
      return new Response(JSON.stringify({ 
        error: 'Failed to process image or save to database: ' + 
          (processingError instanceof Error ? processingError.message : String(processingError)) 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    } finally {
      // Force garbage collection to free up memory
      if (global.gc) {
        try {
          global.gc();
          console.log("Forced garbage collection to free memory");
        } catch (e) {
          console.log("Failed to force garbage collection:", e);
        }
      }
    }
  } catch (error) {
    console.error("Unhandled error in upload API:", error);
    
    // Cleanup if filename was set
    if (fileName) {
      try {
        const supabase = createRouteHandlerClient({ cookies });
        await supabase.storage.from('item-images').remove([fileName]);
      } catch (cleanupError) {
        console.error("Failed to clean up file:", cleanupError);
      }
    }
    
    return new Response(JSON.stringify({ 
      error: 'Server error: ' + (error instanceof Error ? error.message : String(error)) 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
