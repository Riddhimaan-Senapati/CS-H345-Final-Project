// app/page.tsx
'use client';

import { useState, useEffect, useRef, ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ImageIcon, SearchIcon, Upload, Trash2, Search, CheckCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ThemeToggle } from '@/components/ui/theme-toggle';

interface ItemImage {
  image_url: string;
}

interface Profile {
  email: string;
}

interface Item {
  id: string;
  title: string;
  description?: string;
  location: string;
  created_at?: string;
  profiles?: Profile;
  item_images: ItemImage[];
  score?: number;
}

// Add type definition for Auth context
interface AuthContextType {
  user: any; 
  loading: boolean;
  signOut: () => void; // Explicitly define signOut as a function that returns void
}

export default function MainPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('lost'); // Set lost as default tab
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Add type casting for useAuth to fix the signOut error
  const { user, loading: authLoading, signOut } = useAuth() as AuthContextType;
  
  // Upload states
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [searchImage, setSearchImage] = useState<File | null>(null);
  const [searchImagePreview, setSearchImagePreview] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  
  // New states for search progress indication
  const [searchProgress, setSearchProgress] = useState<'idle' | 'searching' | 'complete' | 'error'>('idle');
  const [searchStatusMessage, setSearchStatusMessage] = useState<string>('');
  
  // New states for Milvus upload status
  const [uploadedItemId, setUploadedItemId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'complete' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  
  // State for tracking background processing
  const [processingItems, setProcessingItems] = useState<Record<string, {
    status: string;
    message: string;
    lastChecked: number;
    retryCount: number;
  }>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchFileInputRef = useRef<HTMLInputElement | null>(null);
  const supabase = createClientComponentClient();
  const router = useRouter();
  
  // Function to check if an image has been indexed in Milvus
  const checkMilvusStatus = async (imageId: string) => {
    try {
      const response = await fetch(`/api/milvus/status?imageId=${imageId}`);
      const data = await response.json();
      
      // Update the processing items state
      setProcessingItems(prev => ({
        ...prev,
        [imageId]: {
          status: data.status || 'unknown',
          message: data.message || 'Checking status...',
          lastChecked: Date.now(),
          retryCount: (prev[imageId]?.retryCount || 0) + 1
        }
      }));
      
      if (data.exists) {
        console.log('Image successfully indexed in Milvus!');
        setUploadStatus('complete');
        setStatusMessage('Item fully processed and searchable');
        
        // Remove from processing items after a delay
        setTimeout(() => {
          setProcessingItems(prev => {
            const newState = { ...prev };
            delete newState[imageId];
            return newState;
          });
        }, 5000);
        
        return true;
      } else if (data.status === 'processing') {
        console.log(`Image processing: ${data.message}`);
        setStatusMessage(data.message || 'Item uploaded, processing in database...');
        return false;
      } else if (data.status === 'complete') {
        console.log('Processing complete, waiting for indexing...');
        setStatusMessage('Processing complete, waiting for indexing...');
        return false;
      } else if (data.status === 'error') {
        console.error(`Processing error: ${data.message}`);
        setUploadStatus('error');
        setStatusMessage(`Error: ${data.message || 'Unknown error during processing'}`);
        
        // Remove from processing items after a delay
        setTimeout(() => {
          setProcessingItems(prev => {
            const newState = { ...prev };
            delete newState[imageId];
            return newState;
          });
        }, 10000);
        
        return false;
      } else {
        console.log('Image still being processed...');
        setStatusMessage('Item uploaded, processing in database...');
        return false;
      }
    } catch (error) {
      console.error('Error checking Milvus status:', error);
      return false;
    }
  };
  
  // Polling mechanism for background tasks
  useEffect(() => {
    // Skip if no processing items
    if (Object.keys(processingItems).length === 0) return;
    
    const interval = setInterval(() => {
      Object.entries(processingItems).forEach(([imageId, info]) => {
        // Skip if checked recently (within 2 seconds)
        if (Date.now() - info.lastChecked < 2000) return;
        
        // Skip if retried too many times (max 30 retries = ~1 minute)
        if (info.retryCount > 30) {
          console.log(`Stopped polling for ${imageId} after too many retries`);
          setProcessingItems(prev => {
            const newState = { ...prev };
            delete newState[imageId];
            return newState;
          });
          return;
        }
        
        // Check status
        checkMilvusStatus(imageId);
      });
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, [processingItems]);
  
  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };
  
  const handleSearchImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    setSearchImage(file);
    setSearchImagePreview(URL.createObjectURL(file));
  };
  
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!imageFile) {
      alert('Please select an image');
      return;
    }
    
    if (!title.trim()) {
      alert('Please enter a title');
      return;
    }
    
    if (!location.trim()) {
      alert('Please enter a location');
      return;
    }
    
    setUploadedItemId(null);
    setUploadStatus('uploading');
    setStatusMessage('Uploading item...');
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description || '');
      formData.append('location', location);
      formData.append('image', imageFile);
      
      const response = await fetch('/api/milvus/upload', {
        method: 'POST',
        body: formData,
      });
      
      const text = await response.text();
      
      let result;
      if (text && text.trim()) {
        try {
          result = JSON.parse(text);
        } catch (e) {
          throw new Error(`Invalid response format: ${text.substring(0, 100)}...`);
        }
      } else {
        throw new Error(`Server returned empty response with status: ${response.status}`);
      }
      
      if (!response.ok) {
        throw new Error(result?.error || `Upload failed with status: ${response.status}`);
      }
      
      if (result?.item?.id) {
        setUploadedItemId(result.item.id);
        setUploadStatus('complete');
        setStatusMessage('Item uploaded successfully!');
        
        // Add to processing items
        setProcessingItems(prev => ({
          ...prev,
          [result.item.id]: {
            status: 'unknown',
            message: 'Checking status...',
            lastChecked: Date.now(),
            retryCount: 0
          }
        }));
      }
      
      setTitle('');
      setDescription('');
      setLocation('');
      setImageFile(null);
      setImagePreview(null);
      
    } catch (error) {
      console.error('Error uploading item:', error);
      setUploadStatus('error');
      setStatusMessage(`Error: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };
  
  const handleTextSearch = async () => {
    if (!searchQuery.trim()) {
      setItems([]);
      return;
    }
    
    setLoading(true);
    setSearchProgress('searching');
    setSearchStatusMessage('Searching for items...');
    
    try {
      const response = await fetch('/api/milvus/search/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: searchQuery,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Search failed');
      
      setItems(data.items || []);
      setSearchProgress('complete');
      setSearchStatusMessage(`Found ${data.items?.length || 0} items`);
    } catch (error) {
      console.error('Error searching:', error);
      setItems([]);
      setSearchProgress('error');
      setSearchStatusMessage(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const handleImageSearch = async () => {
    if (!searchImage) return;
    
    setSearchLoading(true);
    setLoading(true);
    setSearchProgress('searching');
    setSearchStatusMessage('Processing image search...');
    
    try {
      const formData = new FormData();
      formData.append('image', searchImage);
      
      const response = await fetch('/api/milvus/search/image', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Search failed');
      
      setItems(data.items || []);
      setSearchProgress('complete');
      setSearchStatusMessage(`Found ${data.items?.length || 0} items`);
    } catch (error) {
      console.error('Error searching by image:', error);
      setItems([]);
      setSearchProgress('error');
      setSearchStatusMessage(`Error: ${(error as Error).message}`);
    } finally {
      setSearchLoading(false);
      setLoading(false);
    }
  };
  
  const handleSearchWithItem = async (imageUrl: string, title: string) => {
    setLoading(true);
    setSearchProgress('searching');
    setSearchStatusMessage(`Finding items similar to "${title}"...`);
    
    try {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }
      
      const imageBlob = await imageResponse.blob();
      
      const fileName = `search-${Date.now()}.jpg`;
      const file = new File([imageBlob], fileName, { type: 'image/jpeg' });
      
      setSearchImage(file);
      setSearchImagePreview(imageUrl);
      
      const formData = new FormData();
      formData.append('image', file);
      
      console.log("Sending search request with image from an existing item...");
      
      const response = await fetch('/api/milvus/search/image', {
        method: 'POST',
        body: formData,
      });
      
      const text = await response.text();
      
      console.log(`Response status: ${response.status}`);
      console.log(`Response text: ${text}`);
      
      if (!response.ok) {
        throw new Error(`Search API error: ${response.status} - ${text}`);
      }
      
      if (!text) {
        console.warn("Received empty response");
        setItems([]);
        setSearchProgress('error');
        setSearchStatusMessage('Error: Empty response from server');
        return;
      }
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Failed to parse response as JSON: ${text}`);
      }
      
      setItems(data.items || []);
      setSearchProgress('complete');
      setSearchStatusMessage(`Found ${data.items?.length || 0} similar items`);
      
      if (activeTab !== 'lost') {
        setActiveTab('lost');
      }
    } catch (error) {
      console.error('Error searching by existing image:', error);
      alert(`Error searching with this image: ${(error as Error).message}`);
      setItems([]);
      setSearchProgress('error');
      setSearchStatusMessage(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSignOut = () => {
    if (typeof signOut === 'function') {
      signOut();
    } else {
      console.error('signOut is not a function');
    }
  };
  
  const handleDeleteItem = async (item: Item) => {
    if (!confirm('Are you sure you want to delete this item?')) {
      return;
    }
    
    setDeleting(true);
    
    try {
      const url = item.item_images[0].image_url;
      const fileName = url.split('/').pop();
      
      const response = await fetch('/api/milvus/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemId: item.id,
          fileName: fileName,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete item');
      }
      
      setItems(items.filter(i => i.id !== item.id));
      
      alert('Item deleted successfully!');
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('Error deleting item: ' + (error as Error).message);
    } finally {
      setDeleting(false);
    }
  };
  
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTextSearch();
    }
  };
  
  if (authLoading) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }
  
  if (!user) {
    return null; 
  }
  
  return (
    <div className="container mx-auto px-4 py-8">
      <header className="flex justify-between items-center mb-8">
        <Link href="/" className="text-2xl font-bold">FindR</Link>
        <div className="space-x-4">
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-gray-700 dark:text-gray-300">{user.email}</span>
              <ThemeToggle />
              <Button 
                variant="destructive" 
                onClick={handleSignOut}
              >
                Sign Out
              </Button>
            </div>
          ) : (
            <>
              <ThemeToggle />
              <Link href="/auth/signin">
                <Button variant="outline">Sign In</Button>
              </Link>
              <Link href="/auth/signup">
                <Button>Sign Up</Button>
              </Link>
            </>
          )}
        </div>
      </header>

      {user ? (
        <main>
          <div className="mb-6 text-center">
            <p className="text-muted-foreground">
              Use the <span className="font-semibold text-lost">Lost Items</span> tab to search for items you've lost.
              Use the <span className="font-semibold text-found">Found Items</span> tab to upload items you've found.
            </p>
          </div>
          
          <Tabs defaultValue="lost" value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full mb-6">
              <TabsTrigger 
                value="lost" 
                className="w-1/2 data-[state=active]:bg-lost data-[state=active]:text-lost-foreground"
              >
                Lost Items
              </TabsTrigger>
              <TabsTrigger 
                value="found" 
                className="w-1/2 data-[state=active]:bg-found data-[state=active]:text-found-foreground"
              >
                Found Items
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="lost">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Search for your lost items..." 
                    value={searchQuery}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                    onKeyPress={handleKeyPress}
                  />
                  <Button 
                    onClick={handleTextSearch}
                    className="bg-lost text-lost-foreground hover:bg-lost/90"
                    disabled={searchProgress === 'searching'}
                  >
                    {searchProgress === 'searching' ? (
                      <>
                        <Clock className="mr-2 h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <SearchIcon className="mr-2 h-4 w-4" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
                
                <div className="flex gap-2">
                  <div 
                    className="border rounded-md flex-1 flex items-center px-3 cursor-pointer"
                    onClick={() => searchFileInputRef.current?.click()}
                  >
                    {searchImagePreview ? (
                      <div className="relative h-10 w-10 mr-2">
                        <Image
                          src={searchImagePreview}
                          alt="Search"
                          fill
                          className="object-cover rounded"
                        />
                      </div>
                    ) : (
                      <ImageIcon className="mr-2 h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-gray-500">
                      {searchImagePreview ? 'Image selected' : 'Upload image to search'}
                    </span>
                    <input
                      type="file"
                      ref={searchFileInputRef}
                      onChange={handleSearchImageChange}
                      accept="image/*"
                      className="hidden"
                      aria-label="Select image for search"
                    />
                  </div>
                  <Button 
                    onClick={handleImageSearch}
                    disabled={!searchImage || searchLoading}
                    className="bg-lost text-lost-foreground hover:bg-lost/90"
                  >
                    {searchLoading ? (
                      <>
                        <Clock className="mr-2 h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        Find Similar
                      </>
                    )}
                  </Button>
                </div>
              </div>
              
              {searchProgress !== 'idle' && (
                <div className={`mb-4 p-3 rounded-md ${
                  searchProgress === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                  searchProgress === 'complete' ? 'bg-green-50 text-green-700 border border-green-200' :
                  'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  <div className="flex items-center">
                    {searchProgress === 'error' && (
                      <div className="mr-2 text-red-500">⚠️</div>
                    )}
                    {searchProgress === 'complete' && (
                      <CheckCircle className="mr-2 h-5 w-5 text-green-500" />
                    )}
                    {searchProgress === 'searching' && (
                      <Clock className="mr-2 h-5 w-5 text-blue-500 animate-pulse" />
                    )}
                    <p className="font-medium">{searchStatusMessage}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {loading ? (
                  <p className="col-span-3 text-center py-8">Searching for items...</p>
                ) : items.length > 0 ? (
                  items.map((item) => (
                    <Card key={item.id} className="p-4 flex flex-col h-full">
                      {item.item_images && item.item_images[0] && (
                        <div className="relative h-48 w-full mb-3 group">
                          <Image
                            src={item.item_images[0].image_url}
                            alt={item.title}
                            fill
                            className="object-cover rounded"
                          />
                          
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded flex flex-col justify-between p-2 text-white">
                            <div className="text-sm font-semibold bg-black/60 self-start px-2 py-1 rounded">
                              Score: {item.score ? item.score.toFixed(4) : 'N/A'}
                            </div>
                            
                            <Button 
                              onClick={() => handleSearchWithItem(item.item_images[0].image_url, item.title)}
                              className="self-end bg-lost text-lost-foreground hover:bg-lost/90"
                              size="sm"
                            >
                              <Search className="h-4 w-4 mr-1" />
                              Search Similar
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      <div className="flex justify-between items-start">
                        <h3 className="font-semibold">{item.title}</h3>
                        
                        {(user.email === item.profiles?.email || user.email === 'riddhimaan22@gmail.com') && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-red-500 hover:text-red-700 hover:bg-red-100 p-1 h-auto"
                            onClick={() => handleDeleteItem(item)}
                            disabled={deleting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Location: {item.location || "Unknown"}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                        Reported by: {item.profiles?.email || "Unknown user"}
                      </p>
                      {item.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">{item.description}</p>
                      )}
                    </Card>
                  ))
                ) : (
                  <p className="col-span-3 text-center py-8 text-gray-500 dark:text-gray-400">
                    {searchQuery || searchImagePreview 
                      ? "No matching items found. Try a different search." 
                      : "Search for lost items using text or image above."}
                  </p>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="found">
              <div className="mb-8">
                <Card className="p-6 border-found/20">
                  <h2 className="text-xl font-semibold mb-4 text-found">Upload a Found Item</h2>
                  <p className="text-muted-foreground mb-4">
                    Found something that might belong to someone else? Upload it here to help it find its way back home.
                  </p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block mb-1">Title *</label>
                      <Input
                        value={title}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                        required
                        placeholder="Item name or brief description"
                      />
                    </div>
                    
                    <div>
                      <label className="block mb-1">Description</label>
                      <Textarea
                        value={description}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="Provide more details about the item"
                      />
                    </div>
                    
                    <div>
                      <label className="block mb-1">Location *</label>
                      <Input
                        value={location}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)}
                        required
                        placeholder="Where was this item found?"
                      />
                    </div>
                    
                    <div>
                      <label className="block mb-1">Image *</label>
                      <div 
                        className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {imagePreview ? (
                          <div className="relative h-48 w-full">
                            <Image
                              src={imagePreview}
                              alt="Preview"
                              fill
                              className="object-contain"
                            />
                          </div>
                        ) : (
                          <div className="py-4">
                            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                            <p>Click to upload an image (required)</p>
                          </div>
                        )}
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleImageChange}
                          accept="image/*"
                          className="hidden"
                          aria-label="Upload image"
                        />
                      </div>
                    </div>
                    
                    <Button 
                      type="submit" 
                      disabled={uploading || !imageFile || !title || !location}
                      className="w-full bg-found text-found-foreground hover:bg-found/90"
                    >
                      {uploading ? (
                        <>
                          <Clock className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        'Upload Found Item'
                      )}
                    </Button>
                    
                    {uploadStatus !== 'idle' && (
                      <div className={`mt-4 p-3 rounded-md ${
                        uploadStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                        uploadStatus === 'complete' ? 'bg-green-50 text-green-700 border border-green-200' :
                        'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        <div className="flex items-center">
                          {uploadStatus === 'error' && (
                            <div className="mr-2 text-red-500">⚠️</div>
                          )}
                          {uploadStatus === 'complete' && (
                            <CheckCircle className="mr-2 h-5 w-5 text-green-500" />
                          )}
                          {uploadStatus === 'uploading' && (
                            <Clock className="mr-2 h-5 w-5 text-blue-500 animate-pulse" />
                          )}
                          <div className="flex-1">
                            <p className="font-medium">
                              {uploadStatus === 'error' ? 'Upload Error' :
                               uploadStatus === 'complete' ? 'Success!' :
                               'Uploading...'}
                            </p>
                            <p className="text-sm">{statusMessage}</p>
                            
                            {/* Progress bar for processing status */}
                            {uploadStatus === 'complete' && statusMessage.includes('processing') && (
                              <div className="mt-2">
                                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 overflow-hidden">
                                  <div 
                                    className="bg-blue-600 h-2.5 rounded-full" 
                                    style={{ width: '60%' }}
                                  ></div>
                                </div>
                                <p className="text-xs mt-1 text-gray-500">
                                  Background processing in progress...
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {uploadStatus === 'complete' && statusMessage.includes('fully processed') && (
                          <div className="mt-2 text-sm">
                            <p>Your item has been successfully uploaded and is now searchable.</p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {Object.keys(processingItems).length > 0 && (
                      <div className="mt-4 border border-gray-200 rounded-md overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                          <h3 className="text-sm font-medium text-gray-700">Background Processing</h3>
                        </div>
                        <div className="divide-y divide-gray-200">
                          {Object.entries(processingItems).map(([imageId, info]) => (
                            <div key={imageId} className="px-4 py-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                  {info.status === 'processing' && (
                                    <div className="mr-2 h-4 w-4 rounded-full bg-blue-500 animate-pulse"></div>
                                  )}
                                  {info.status === 'complete' && (
                                    <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                                  )}
                                  {info.status === 'error' && (
                                    <div className="mr-2 text-red-500">⚠️</div>
                                  )}
                                  <div>
                                    <p className="text-sm font-medium text-gray-700">
                                      Item {imageId.substring(0, 8)}...
                                    </p>
                                    <p className="text-xs text-gray-500">{info.message}</p>
                                  </div>
                                </div>
                                {info.status === 'processing' && (
                                  <div className="ml-4 w-24">
                                    <div className="w-full bg-gray-200 rounded-full h-1.5 dark:bg-gray-700">
                                      <div 
                                        className="bg-blue-600 h-1.5 rounded-full" 
                                        style={{ 
                                          width: `${Math.min(100, info.retryCount * 3.3)}%`,
                                          transition: 'width 0.5s ease-in-out'
                                        }}
                                      ></div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </form>
                </Card>
              </div>
              
              <div className="text-center py-4">
                <p className="text-gray-500 dark:text-gray-400">
                  Thank you for helping return lost items to their owners.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      ) : (
        <div className="text-center py-12">
          <p>Please sign in to access this page</p>
        </div>
      )}
    </div>
  );
}