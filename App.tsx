
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Shot, StyleDistillation, AppStatus, AssetImage, ProductionMode } from './types';
import { distillStyle, deductStoryboard, renderShot, removeWatermark } from './geminiService';
import { db } from './db';

const MASTER_KEYS = {
  ASSETS: 'pf_master_assets_v30',
  STYLE: 'pf_master_style_v30',
  SCRIPT: 'pf_master_script_v30',
  IMAGES: 'pf_master_images_v30',
  SHOTS: 'pf_master_shots_v30',
  THEME: 'pf_master_theme_v30',
  MODE: 'pf_master_mode_v30'
};

const compressImage = (base64Str: string, maxWidth = 1024, quality = 0.6): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, width, height);
      }
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
};

const App: React.FC = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [productionMode, setProductionMode] = useState<ProductionMode>('cinematic');
  
  const [images, setImages] = useState<string[]>([]);
  const [style, setStyle] = useState<StyleDistillation | null>(null);
  const [script, setScript] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [shotCount, setShotCount] = useState<number>(4);
  const [directorLog, setDirectorLog] = useState<string[]>([]);

  // Purifier V5.2 - State Management
  const [showPurifier, setShowPurifier] = useState(false);
  const [purifyInput, setPurifyInput] = useState<string | null>(null);
  const [purifyOutput, setPurifyOutput] = useState<string | null>(null);
  const [isPurifying, setIsPurifying] = useState(false);
  const [maskVault, setMaskVault] = useState<Record<string, string>>({}); 
  const [maskHistory, setMaskHistory] = useState<Record<string, string[]>>({}); // Undo system
  const [compareSplit, setCompareSplit] = useState(50);
  const [isDraggingPurify, setIsDraggingPurify] = useState(false);
  const [selectedInMatrix, setSelectedInMatrix] = useState<Set<string>>(new Set());
  const [processingBatch, setProcessingBatch] = useState<Set<string>>(new Set());
  
  // Brush System
  const [brushSize, setBrushSize] = useState(40);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });

  useEffect(() => {
    const initApp = async () => {
      const [sStyle, sScript, sImages, sShots, sTheme, sMode] = await Promise.all([
        db.get(MASTER_KEYS.STYLE), db.get(MASTER_KEYS.SCRIPT),
        db.get(MASTER_KEYS.IMAGES), db.get(MASTER_KEYS.SHOTS), db.get(MASTER_KEYS.THEME),
        db.get(MASTER_KEYS.MODE)
      ]);
      if (sStyle) setStyle(sStyle);
      if (sScript) setScript(sScript);
      if (sImages) setImages(sImages);
      if (sShots) setShots(sShots);
      if (sTheme) setTheme(sTheme || 'dark');
      if (sMode) setProductionMode(sMode);
      setIsLoaded(true);
    };
    initApp();
  }, []);

  useEffect(() => {
    if (isLoaded) {
      db.set(MASTER_KEYS.STYLE, style);
      db.set(MASTER_KEYS.SCRIPT, script);
      db.set(MASTER_KEYS.IMAGES, images);
      db.set(MASTER_KEYS.SHOTS, shots);
      db.set(MASTER_KEYS.THEME, theme);
      db.set(MASTER_KEYS.MODE, productionMode);
    }
  }, [style, script, images, shots, theme, productionMode, isLoaded]);

  // --- Canvas Core & Undo Logic ---
  const syncCanvasSize = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !purifyInput) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const history = maskHistory[purifyInput] || [];
      if (history.length > 0) {
        const maskImg = new Image();
        maskImg.onload = () => ctx.drawImage(maskImg, 0, 0);
        maskImg.src = history[history.length - 1];
      } else {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };
    img.src = purifyInput;
  }, [purifyInput, maskHistory]);

  useEffect(() => {
    if (showPurifier && purifyInput) syncCanvasSize();
  }, [purifyInput, showPurifier, syncCanvasSize]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showPurifier) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPurifier, purifyInput, maskHistory]);

  const handleUndo = () => {
    if (!purifyInput) return;
    const history = maskHistory[purifyInput] || [];
    if (history.length <= 1) {
      // If only one (or zero) states, clear to black
      const ctx = maskCanvasRef.current?.getContext('2d');
      if (ctx && maskCanvasRef.current) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      }
      setMaskHistory(prev => ({ ...prev, [purifyInput]: [] }));
    } else {
      const nextHistory = history.slice(0, -1);
      const lastState = nextHistory[nextHistory.length - 1];
      const ctx = maskCanvasRef.current?.getContext('2d');
      if (ctx && lastState) {
        const img = new Image();
        img.onload = () => {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, maskCanvasRef.current!.width, maskCanvasRef.current!.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = lastState;
      }
      setMaskHistory(prev => ({ ...prev, [purifyInput]: nextHistory }));
    }
  };

  const getEventPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return { x: 0, y: 0, viewX: 0, viewY: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const canvasAspect = canvas.width / canvas.height;
    const rectAspect = rect.width / rect.height;
    
    let actualWidth = rect.width;
    let actualHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (rectAspect > canvasAspect) {
      actualWidth = rect.height * canvasAspect;
      offsetX = (rect.width - actualWidth) / 2;
    } else {
      actualHeight = rect.width / canvasAspect;
      offsetY = (rect.height - actualHeight) / 2;
    }

    const x = ((clientX - rect.left - offsetX) / actualWidth) * canvas.width;
    const y = ((clientY - rect.top - offsetY) / actualHeight) * canvas.height;

    return { x, y, viewX: clientX, viewY: clientY };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (purifyOutput) return;
    setIsDrawing(true);
    const { x, y } = getEventPos(e);
    const ctx = maskCanvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getEventPos(e);
    setMousePos({ x: pos.viewX, y: pos.viewY });
    if (!isDrawing) return;
    const ctx = maskCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'white';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      if (maskCanvasRef.current && purifyInput) {
        const dataUrl = maskCanvasRef.current.toDataURL();
        setMaskHistory(prev => ({
          ...prev,
          [purifyInput]: [...(prev[purifyInput] || []), dataUrl]
        }));
      }
    }
  };

  const clearMask = () => {
    if (!purifyInput) return;
    const ctx = maskCanvasRef.current?.getContext('2d');
    if (ctx && maskCanvasRef.current) {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      setMaskHistory(prev => ({ ...prev, [purifyInput]: [] }));
    }
  };

  const toggleSelection = (img: string) => {
    setSelectedInMatrix(prev => {
      const next = new Set(prev);
      if (next.has(img)) next.delete(img);
      else next.add(img);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedInMatrix.size === images.length) setSelectedInMatrix(new Set());
    else setSelectedInMatrix(new Set(images));
  };

  const handleBatchDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setIsDraggingPurify(false);
    if (!e.dataTransfer.files.length) return;
    
    const files = (Array.from(e.dataTransfer.files) as File[]).filter(f => f.type.startsWith('image/'));
    const newImgs: string[] = [];
    
    for (const file of files) {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      const compressed = await compressImage(base64);
      newImgs.push(compressed);
    }

    setImages(prev => [...newImgs, ...prev]);
    if (newImgs.length > 0) {
      setPurifyInput(newImgs[0]);
      setPurifyOutput(null);
    }
    log(`📥 矩阵已同步 ${newImgs.length} 个新样本。`);
  };

  const log = (msg: string) => setDirectorLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15)]);

  const handlePurifyBatch = async () => {
    const targets: string[] = Array.from(selectedInMatrix);
    if (targets.length === 0) return;
    
    let maskData: string | undefined = undefined;
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const pixels = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
      let hasContent = false;
      if (pixels) {
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 20) { hasContent = true; break; }
        }
      }
      if (hasContent) maskData = canvas.toDataURL('image/jpeg', 0.8);
    }

    setIsPurifying(true);
    setProcessingBatch(new Set(targets));
    log(`🚀 启动批处理，目标: ${targets.length}`);

    const finished = await Promise.all(targets.map(async (img: string) => {
      try {
        const res = await removeWatermark(img, maskData);
        setProcessingBatch(prev => {
           const next = new Set(prev);
           next.delete(img);
           return next;
        });
        return res;
      } catch (err) {
        console.error(`Failed: ${img.substring(0, 20)}`, err);
        return null;
      }
    }));
    
    const successResults = finished.filter((r): r is string => !!r);
    setImages(prev => [...successResults, ...prev]);
    setIsPurifying(false);
    setProcessingBatch(new Set());
    setSelectedInMatrix(new Set());
    log(`✅ 批量净化完成: ${successResults.length} 成功。`);
  };

  const handlePurifySingle = async () => {
    if (!purifyInput) return;
    setIsPurifying(true);
    setPurifyOutput(null);
    try {
      const canvas = maskCanvasRef.current;
      let maskData: string | undefined = undefined;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const pixels = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
        let hasContent = false;
        if (pixels) {
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 20) { hasContent = true; break; }
          }
        }
        if (hasContent) maskData = canvas.toDataURL('image/jpeg', 0.8);
      }
      const result = await removeWatermark(purifyInput, maskData);
      setPurifyOutput(result);
      log('✨ 单张净化成功。');
    } catch (e: any) {
      log(`❌ 净化失败: ${e.message}`);
    } finally {
      setIsPurifying(false);
    }
  };

  const isDark = theme === 'dark';
  const glass = isDark ? 'bg-[#121217]/80 backdrop-blur-xl border-white/5' : 'bg-white/80 backdrop-blur-xl border-black/5 shadow-sm';

  return (
    <div className={`h-screen w-full flex flex-col overflow-hidden transition-colors duration-500 ${isDark ? 'bg-[#0a0a0c] text-white' : 'bg-[#f4f4f7] text-black'}`}>
      
      {/* Top Bar */}
      <header className={`h-16 flex items-center justify-between px-10 border-b ${isDark ? 'border-white/5' : 'border-black/5'}`}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-white shadow-lg shadow-blue-600/20">PF</div>
          <h1 className="font-black text-xs tracking-widest uppercase italic">Director's Studio <span className="text-blue-500 ml-1">V30.0</span></h1>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={() => setShowPurifier(true)} className="px-6 py-2 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full text-[10px] font-black uppercase hover:bg-cyan-500 hover:text-white transition-all shadow-lg">启动净化矩阵</button>
          <button onClick={() => setTheme(isDark ? 'light' : 'dark')} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/5 text-lg">
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Main Studio Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[300px_1fr_420px] gap-6 p-6 overflow-hidden">
        
        {/* DNA Archive */}
        <aside className={`rounded-[32px] border p-6 flex flex-col gap-6 overflow-hidden ${glass}`}>
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">视觉 DNA 存档</span>
            <div className={`w-2 h-2 rounded-full ${style ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          </div>
          <div className="grid grid-cols-3 gap-3 overflow-y-auto scrollbar-hide flex-1 max-h-[250px]">
             {images.map((img, i) => (
               <div key={i} className="aspect-square relative group rounded-2xl overflow-hidden border border-white/5">
                 <img src={img} className="w-full h-full object-cover group-hover:scale-110 transition-transform cursor-pointer" />
                 <button onClick={() => setImages(p => p.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] hidden group-hover:flex items-center justify-center">×</button>
               </div>
             ))}
             <div className="aspect-square border-2 border-dashed border-current opacity-20 rounded-2xl flex items-center justify-center text-3xl hover:opacity-100 transition-all cursor-pointer">+</div>
          </div>
          <button onClick={async () => {
             setStatus(AppStatus.DISTILLING);
             try { setStyle(await distillStyle(images)); log('🎨 风格解析完成。'); } finally { setStatus(AppStatus.IDLE); }
          }} className="w-full py-4 bg-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white hover:brightness-110 shadow-xl shadow-blue-600/20">提取核心视觉</button>
          <div className="flex-1 rounded-3xl bg-black/20 p-6 border border-white/5 overflow-y-auto scrollbar-hide">
             {style ? <p className="text-xs leading-relaxed opacity-80 italic">{style.summary}</p> : <div className="h-full flex items-center justify-center opacity-10 text-[10px] uppercase font-black tracking-[0.3em]">待机中</div>}
          </div>
        </aside>

        {/* Script Console */}
        <section className={`rounded-[40px] border p-8 flex flex-col gap-6 overflow-hidden ${glass}`}>
           <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder="在此撰写你的剧本描述..." className="flex-1 bg-transparent border-none outline-none resize-none text-lg font-medium leading-loose placeholder:opacity-20" />
           <div className="h-16 flex items-center justify-between px-6 bg-black/20 rounded-3xl border border-white/5">
              <div className="flex items-center gap-4">
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="bg-transparent text-[10px] font-black uppercase border-none outline-none">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                </select>
                <div className="w-px h-4 bg-white/10"></div>
                <div className="flex gap-2">
                  {[1, 2, 4].map(n => <button key={n} onClick={() => setShotCount(n)} className={`w-8 h-8 rounded-lg text-[10px] font-black transition-all ${shotCount === n ? 'bg-blue-600 text-white' : 'opacity-20 hover:opacity-100'}`}>{n}</button>)}
                </div>
              </div>
              <button onClick={async () => {
                if (!style || !script) return;
                setStatus(AppStatus.DEDUCTING);
                try {
                  const newShots = await deductStoryboard(script, style, shotCount, productionMode);
                  setShots(p => [...newShots.map(s => ({ ...s, isGenerating: true })), ...p]);
                  for (const s of newShots) {
                    const url = await renderShot(s.englishPrompt, style, aspectRatio, [], [], productionMode);
                    setShots(p => p.map(it => it.id === s.id ? { ...it, imageUrl: url, isGenerating: false } : it));
                  }
                } finally { setStatus(AppStatus.IDLE); }
              }} className="px-10 py-3 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-lg">生成分镜</button>
           </div>
        </section>

        {/* Live Monitor */}
        <aside className={`rounded-[32px] border p-6 flex flex-col gap-6 overflow-hidden ${glass}`}>
          <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">分镜监控流</span>
          <div className="flex-1 overflow-y-auto space-y-6 pr-2 scrollbar-hide pb-20">
            {shots.map(shot => (
              <div key={shot.id} className="p-4 rounded-3xl bg-white/[0.02] border border-white/5 group">
                <div className="aspect-video bg-black rounded-2xl overflow-hidden mb-4 relative shadow-2xl">
                  {shot.imageUrl ? <img src={shot.imageUrl} className="w-full h-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center animate-pulse opacity-20 text-[10px] font-black uppercase">绘制中...</div>}
                </div>
                <p className="text-[11px] leading-relaxed opacity-70 italic line-clamp-2">{shot.chineseDescription}</p>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {/* 净化矩阵 V5.2 - Matrix System */}
      {showPurifier && (
        <div className="fixed inset-0 z-[1000] bg-[#020205] text-white flex flex-col animate-in fade-in overflow-hidden">
           {/* Matrix Header */}
           <div className="h-20 px-12 flex items-center justify-between border-b border-white/10 shrink-0 bg-black/40 backdrop-blur-2xl">
              <div className="flex flex-col">
                <h3 className="text-2xl font-black italic text-cyan-400 flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                  净化矩阵 V5.2
                </h3>
                <span className="text-[8px] opacity-30 uppercase font-black tracking-widest italic">INTUITIVE RESTORATION / DUAL DOMAIN INTERFACE</span>
              </div>
              <div className="flex items-center gap-10">
                 <div className="flex bg-white/5 p-1 rounded-xl">
                    <button onClick={selectAll} className="px-4 py-2 text-[10px] font-black uppercase hover:text-cyan-400 transition-colors">样本全选</button>
                 </div>
                 <button onClick={() => setShowPurifier(false)} className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 hover:bg-red-500/20 hover:rotate-90 transition-all text-2xl font-light">×</button>
              </div>
           </div>

           <div className="flex-1 flex overflow-hidden">
              {/* Batch Sidebar */}
              <aside className="w-[300px] border-r border-white/10 bg-black/60 flex flex-col p-8 overflow-hidden">
                 <span className="text-[10px] font-black uppercase text-white/30 tracking-widest mb-6">样本序列 ({images.length})</span>
                 <div className="flex-1 overflow-y-auto space-y-4 pr-3 scrollbar-hide">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative group">
                        <div onClick={() => { setPurifyInput(img); setPurifyOutput(null); }} className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer transition-all border-2 ${purifyInput === img ? 'border-cyan-500 scale-95 shadow-2xl shadow-cyan-500/40' : 'border-transparent opacity-30 hover:opacity-100'}`}>
                          <img src={img} className="w-full h-full object-cover" />
                          {processingBatch.has(img) && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <div className="w-6 h-6 border-2 border-t-cyan-400 border-white/10 rounded-full animate-spin"></div>
                            </div>
                          )}
                        </div>
                        <input 
                          type="checkbox" 
                          checked={selectedInMatrix.has(img)}
                          onChange={() => toggleSelection(img)}
                          className="absolute top-2 left-2 w-4 h-4 accent-cyan-400 cursor-pointer rounded"
                        />
                      </div>
                    ))}
                 </div>
              </aside>

              {/* Central Workspace */}
              <div className="flex-1 flex flex-col bg-[#050508] p-10 overflow-hidden">
                 <div className="flex-1 flex gap-8 overflow-hidden">
                    
                    {/* Input Domain (Science Blue) */}
                    <div className="flex-1 flex flex-col gap-4 relative group">
                       <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 bg-cyan-600/90 rounded-full text-[9px] font-black uppercase tracking-widest shadow-2xl">原始样本 / Before</div>
                       <div className={`flex-1 rounded-[40px] border-2 transition-all duration-500 overflow-hidden relative shadow-2xl ${isDrawing ? 'border-cyan-400/60 bg-cyan-400/5' : 'border-cyan-500/20 bg-black'}`}>
                          {purifyInput ? (
                            <div className="w-full h-full flex items-center justify-center p-4 relative">
                               <div className="relative inline-block max-w-full max-h-full rounded-xl overflow-hidden">
                                  <img src={purifyInput} className="max-w-full max-h-full object-contain block opacity-80" />
                                  <canvas 
                                    ref={maskCanvasRef} 
                                    onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                                    className="absolute inset-0 w-full h-full opacity-60 mix-blend-screen cursor-none"
                                    style={{ display: purifyOutput ? 'none' : 'block' }}
                                  />
                                  <div className="fixed pointer-events-none rounded-full border border-cyan-400 mix-blend-difference z-[2000] shadow-[0_0_15px_rgba(34,211,238,0.5)]" style={{ width: brushSize, height: brushSize, left: mousePos.x - brushSize/2, top: mousePos.y - brushSize/2 }}>
                                    <div className="absolute inset-0 rounded-full border border-white/20 animate-ping opacity-20"></div>
                                  </div>
                               </div>
                            </div>
                          ) : <div className="h-full flex items-center justify-center opacity-10 uppercase text-[10px] font-black tracking-widest">待入库图片样本</div>}
                       </div>
                       
                       {/* Control Bar */}
                       <div className="flex items-center justify-between px-6 py-4 bg-white/5 rounded-3xl border border-white/5">
                          <div className="flex items-center gap-6">
                             <button onClick={handleUndo} title="撤销 (Ctrl+Z)" className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-cyan-500/20 transition-all text-lg">↩️</button>
                             <button onClick={clearMask} title="清空所有涂鸦" className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-red-500/20 transition-all text-lg">🗑️</button>
                             <div className="w-px h-6 bg-white/10 mx-2"></div>
                             <div className="flex flex-col gap-1 w-32">
                                <span className="text-[8px] font-black opacity-30 uppercase">笔触大小: {brushSize}px</span>
                                <input type="range" min="5" max="200" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="accent-cyan-400" />
                             </div>
                          </div>
                          <button 
                            disabled={!purifyInput || isPurifying} 
                            onClick={handlePurifySingle} 
                            className={`px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${!purifyInput || isPurifying ? 'bg-white/5 opacity-10' : 'bg-cyan-500 hover:scale-105 active:scale-95 shadow-xl shadow-cyan-500/30'}`}
                          >
                             {isPurifying ? '重建中...' : '启动净化'}
                          </button>
                       </div>
                    </div>

                    {/* Bridge (Batch Processor) */}
                    <div className="w-16 flex flex-col items-center justify-center gap-6">
                        <button 
                          disabled={selectedInMatrix.size === 0 || isPurifying} 
                          onClick={handlePurifyBatch}
                          className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl transition-all ${selectedInMatrix.size === 0 || isPurifying ? 'bg-white/5 opacity-10' : 'bg-blue-600 hover:scale-110'}`}
                        >
                          🌪️
                        </button>
                        <div className="w-px h-10 bg-white/10"></div>
                        <span className="text-[7px] font-black uppercase text-center opacity-30 tracking-widest">批量<br/>模式</span>
                    </div>

                    {/* Output Domain (Flowing Green) */}
                    <div className="flex-1 flex flex-col gap-4 relative">
                       <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 bg-emerald-600/90 rounded-full text-[9px] font-black uppercase tracking-widest shadow-2xl">净化结果 / After</div>
                       <div className={`flex-1 rounded-[40px] border-2 transition-all duration-700 relative overflow-hidden flex items-center justify-center p-4 bg-[#020205] ${purifyOutput ? 'border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.15)]' : 'border-white/5'}`}>
                          {purifyOutput ? (
                            <div className="relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden group">
                               <img src={purifyInput!} className="max-w-full max-h-full object-contain opacity-20" />
                               <div className="absolute inset-0 pointer-events-none" style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}>
                                  <img src={purifyOutput} className="w-full h-full object-contain" />
                               </div>
                               <div className="absolute inset-0 cursor-ew-resize">
                                  <div className="absolute top-0 bottom-0 w-[2px] bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)]" style={{ left: `${compareSplit}%` }}>
                                     <div className="absolute top-1/2 -left-6 w-12 h-12 rounded-full bg-[#10b981] border-4 border-[#050508] flex items-center justify-center text-white font-black shadow-2xl group-hover:scale-110 transition-transform">↔</div>
                                  </div>
                                  <input type="range" min="0" max="100" value={compareSplit} onChange={e => setCompareSplit(parseInt(e.target.value))} className="absolute inset-0 opacity-0 cursor-ew-resize" />
                               </div>
                            </div>
                          ) : isPurifying ? (
                            <div className="flex flex-col items-center gap-6">
                              <div className="w-16 h-16 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin" />
                              <p className="text-[10px] font-black uppercase text-emerald-500 animate-pulse tracking-widest">正在进行分子级像素重建...</p>
                            </div>
                          ) : <div className="text-center opacity-5 uppercase font-black text-[12px] tracking-[0.4em]">能量场就绪</div>}
                       </div>

                       {/* Action Bar */}
                       <div className="flex items-center justify-center gap-4 py-4 px-6 bg-white/5 rounded-3xl border border-white/5">
                          {purifyOutput ? (
                             <>
                               <button onClick={() => { setImages(p => [purifyOutput, ...p]); setPurifyOutput(null); log('✅ 净化样本已成功持久化。'); }} className="px-10 h-12 rounded-xl bg-emerald-600 text-white font-black text-[9px] uppercase tracking-widest hover:brightness-110">保存并持久化</button>
                               <button onClick={() => { setPurifyInput(purifyOutput); setPurifyOutput(null); log('🔄 结果回传，开始二次净化。'); }} className="px-6 h-12 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase hover:bg-white/10">回传二次处理</button>
                             </>
                          ) : <span className="text-[9px] font-black uppercase opacity-20 tracking-widest">等待数据流输出</span>}
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Welcome */}
      {showWelcome && (
        <div className="fixed inset-0 bg-[#020205] z-[9000] flex flex-col items-center justify-center p-8 text-white text-center animate-in fade-in duration-1000">
            <div className="w-32 h-32 bg-blue-600 rounded-[40px] mb-12 flex items-center justify-center text-5xl font-black shadow-2xl">PF</div>
            <h1 className="text-6xl font-black mb-10 italic uppercase tracking-[0.2em] opacity-90">PromptFlow V30.0</h1>
            <button onClick={() => setShowWelcome(false)} className="px-16 py-6 bg-white text-black rounded-[24px] font-black text-sm uppercase tracking-[0.2em] hover:bg-blue-600 hover:text-white transition-all">进入创作空间</button>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .animate-in { animation: animate-in 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes animate-in { from { opacity: 0; transform: translateY(40px) scale(0.96); filter: blur(10px); } to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); } }
        canvas { touch-action: none; background: transparent; }
      `}</style>
    </div>
  );
};

export default App;
