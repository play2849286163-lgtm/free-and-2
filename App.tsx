
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Shot, StyleDistillation, AppStatus, Asset, AssetImage } from './types';
import { distillStyle, deductStoryboard, renderShot, removeWatermark } from './geminiService';
import { db } from './db';

const MASTER_KEYS = {
  ASSETS: 'pf_master_assets_v3_final_v6',
  STYLE: 'pf_master_style_v3_final_v6',
  SCRIPT: 'pf_master_script_v3_final_v6',
  IMAGES: 'pf_master_images_v3_final_v6',
  SHOTS: 'pf_master_shots_v3_final_v6',
  THEME: 'pf_master_theme_v3_final_v6'
};

const compressImage = (base64Str: string, maxWidth = 1024, quality = 0.5): Promise<string> => {
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
    img.onerror = () => resolve(base64Str);
  });
};

interface PurifyItem {
  id: string;
  input: string;
  output?: string;
  status: 'pending' | 'working' | 'done' | 'error';
}

type SortOption = 'name-asc' | 'name-desc' | 'newest' | 'oldest' | 'status';
type FilterOption = 'all' | 'active' | 'inactive';

const App: React.FC = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  const [images, setImages] = useState<string[]>([]);
  const [style, setStyle] = useState<StyleDistillation | null>(null);
  const [script, setScript] = useState('');
  const [freePrompt, setFreePrompt] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [shotCount, setShotCount] = useState<number>(4);
  
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [filterByStatus, setFilterByStatus] = useState<FilterOption>('all');
  
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [showAssetCreator, setShowAssetCreator] = useState<{type: 'character' | 'scene', editId?: string} | null>(null);
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetImages, setNewAssetImages] = useState<AssetImage[]>([]);

  // 校验失败的视觉高亮状态
  const [valErrScript, setValErrScript] = useState(false);
  const [valErrStyle, setValErrStyle] = useState(false);

  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);

  const [showTheater, setShowTheater] = useState(false);
  const [showPurifier, setShowPurifier] = useState(false);
  const [purifyQueue, setPurifyQueue] = useState<PurifyItem[]>([]);
  const [isPurifyingBatch, setIsPurifyingBatch] = useState(false);
  const [directorLog, setDirectorLog] = useState<string[]>(['[生产枢纽]：Director Core V28.9 视野同步。']);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetImageInputRef = useRef<HTMLInputElement>(null);
  const purifierInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initApp = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio) setHasApiKey(await aistudio.hasSelectedApiKey());
      try {
        const [sAssets, sStyle, sScript, sImages, sShots, sTheme] = await Promise.all([
          db.get(MASTER_KEYS.ASSETS),
          db.get(MASTER_KEYS.STYLE),
          db.get(MASTER_KEYS.SCRIPT),
          db.get(MASTER_KEYS.IMAGES),
          db.get(MASTER_KEYS.SHOTS),
          db.get(MASTER_KEYS.THEME)
        ]);
        if (sAssets) setAssets(sAssets);
        if (sStyle) setStyle(sStyle);
        if (sScript) setScript(sScript);
        if (sImages) setImages(sImages);
        if (sShots) setShots(sShots);
        if (sTheme) setTheme(sTheme || 'light');
      } catch (e) { log('❌ 存档读取异常。'); } 
      finally { setIsLoaded(true); }
    };
    initApp();
  }, []);

  useEffect(() => {
    if (isLoaded) {
      db.set(MASTER_KEYS.ASSETS, assets);
      db.set(MASTER_KEYS.STYLE, style);
      db.set(MASTER_KEYS.SCRIPT, script);
      db.set(MASTER_KEYS.IMAGES, images);
      db.set(MASTER_KEYS.SHOTS, shots);
      db.set(MASTER_KEYS.THEME, theme);
    }
  }, [assets, style, script, images, shots, theme, isLoaded]);

  const log = (msg: string) => setDirectorLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 19)]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const checkApiKey = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      await aistudio.openSelectKey();
      setHasApiKey(true);
      return true;
    }
    return false;
  };

  const openAssetEditor = (asset: Asset) => {
    setNewAssetName(asset.name);
    setNewAssetImages([...asset.images]);
    setShowAssetCreator({ type: asset.type, editId: asset.id });
  };

  const toggleAssetStatus = (id: string) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, isActive: !a.isActive } : a));
    log(`🔄 资产状态已变更。`);
  };

  const performDeleteAsset = (id: string) => {
    setAssets(prev => {
      const next = prev.filter(a => a.id !== id);
      log(`🗑️ 资产 "${id}" 已从核心库物理抹除。`);
      return next;
    });
    setAssetToDelete(null);
    if (showAssetCreator?.editId === id) setShowAssetCreator(null);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedAssetId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    
    const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
    ghost.style.opacity = "0.5";
    ghost.style.position = "absolute";
    ghost.style.top = "-1000px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedAssetId !== targetId) {
      setDragOverAssetId(targetId);
    }
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    setDragOverAssetId(null);
  };

  const handleDragEnd = () => {
    setDraggedAssetId(null);
    setDragOverAssetId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverAssetId(null);
    if (!draggedAssetId || draggedAssetId === targetId) {
      setDraggedAssetId(null);
      return;
    }

    setAssets(prev => {
      const next = [...prev];
      const draggedIndex = next.findIndex(a => a.id === draggedAssetId);
      const targetIndex = next.findIndex(a => a.id === targetId);
      
      if (draggedIndex === -1 || targetIndex === -1) return prev;

      const [draggedItem] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, draggedItem);
      
      log(`🎯 资产 "${draggedItem.name}" 位置已重排。`);
      return next;
    });
    setDraggedAssetId(null);
  };

  const saveAsset = () => {
    if (!newAssetName || newAssetImages.length === 0) return;
    if (showAssetCreator?.editId) {
      setAssets(prev => prev.map(a => a.id === showAssetCreator.editId ? { ...a, name: newAssetName, images: newAssetImages } : a));
      log(`📝 资产 "${newAssetName}" 配置架构已更新。`);
    } else {
      setAssets(prev => [...prev, { id: `asset-${Date.now()}`, name: newAssetName, type: showAssetCreator!.type, images: newAssetImages, isActive: true }]);
      log(`➕ 资产 "${newAssetName}" 已成功录入。`);
    }
    setShowAssetCreator(null);
    setNewAssetImages([]);
    setNewAssetName('');
  };

  const downloadShot = (imageUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${fileName}.png`;
    link.click();
  };

  const handleDeduct = async () => {
    // 校验 API Key
    if (!hasApiKey) { const ok = await checkApiKey(); if (!ok) return; }

    // 严谨的数据检查与引导
    const isScriptMissing = !script.trim();
    const isStyleMissing = !style;

    if (isScriptMissing || isStyleMissing) {
      if (isScriptMissing) {
        log('⚠️ 生产阻塞：[Scenario Studio] 剧本内容为空。');
        setValErrScript(true);
        setTimeout(() => setValErrScript(false), 2000);
      }
      if (isStyleMissing) {
        log('⚠️ 生产阻塞：[Visual DNA] 视觉基因尚未解构。请先在左侧上传参考图并点击“启动视觉解构”。');
        setValErrStyle(true);
        setTimeout(() => setValErrStyle(false), 2000);
      }
      return;
    }

    setStatus(AppStatus.DEDUCTING);
    const placeholders: Shot[] = Array(shotCount).fill(0).map((_, i) => ({
      id: `placeholder-${Date.now()}-${i}`,
      name: `Scene 0${i+1}`,
      composition: 'Rendering',
      flowLogic: '',
      chineseDescription: '正在分析导演意图...',
      englishPrompt: '',
      dialogue: '',
      speaker: '',
      gender: 'narrator',
      emotion: '',
      ambientSfx: '',
      isGenerating: true
    }));
    setShots(prev => [...placeholders, ...prev]);

    try { 
      log(`🎬 启动推演：生产 ${shotCount} 组分镜...`);
      const newShots = await deductStoryboard(script, style!, shotCount);
      setShots(prev => {
        const filtered = prev.filter(s => !s.id.startsWith('placeholder-'));
        return [...newShots.map(s => ({ ...s, isGenerating: true })), ...filtered];
      });

      const charAssets = assets.filter(a => a.isActive && a.type === 'character');
      const sceneAssets = assets.filter(a => a.isActive && a.type === 'scene');

      for (let i = 0; i < newShots.length; i++) {
        const shot = newShots[i];
        try {
          const finalPrompt = shot.englishPrompt + (freePrompt ? `, ${freePrompt}` : '');
          const url = await renderShot(finalPrompt, style!, aspectRatio, charAssets, sceneAssets);
          setShots(prev => prev.map(s => s.id === shot.id ? { ...s, imageUrl: url, isGenerating: false } : s));
          if (i < newShots.length - 1) await new Promise(r => setTimeout(r, 1500));
        } catch (e: any) { log('⚠️ 渲染引擎繁忙，正在重试。'); }
      }
      log('✅ 任务圆满交付。');
    } catch (e: any) { 
      log(`❌ 推演异常：${e.message}`);
      setShots(prev => prev.filter(s => !s.id.startsWith('placeholder-')));
    } finally { 
      setStatus(AppStatus.IDLE); 
    }
  };

  const handleDistill = async () => {
    if (images.length === 0) { 
        log('⚠️ 无法解构：请先在 [Visual DNA] 区域提供 DNA 样本图。'); 
        setValErrStyle(true);
        setTimeout(() => setValErrStyle(false), 2000);
        return; 
    }
    setStatus(AppStatus.DISTILLING);
    try { 
      const res = await distillStyle(images);
      setStyle(res); 
      log('🎨 视觉基因解构成功。'); 
    } catch (e: any) { log(`❌ 解构异常：${e.message}`); } 
    finally { setStatus(AppStatus.IDLE); }
  };

  const handlePurifyBatch = async () => {
    if (isPurifyingBatch) return;
    const pending = purifyQueue.filter(i => i.status === 'pending');
    if (pending.length === 0) return;
    setIsPurifyingBatch(true);
    log(`✨ 净化矩阵已上线：正在并发处理 ${pending.length} 个样本...`);

    const processItem = async (item: PurifyItem) => {
      setPurifyQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'working' } : p));
      try {
        const result = await removeWatermark(item.input);
        setPurifyQueue(prev => prev.map(p => p.id === item.id ? { ...p, output: result, status: 'done' } : p));
      } catch (e) {
        setPurifyQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'error' } : p));
      }
    };

    await Promise.all(pending.map(item => processItem(item)));
    setIsPurifyingBatch(false);
    log(`✅ 净化队列批处理完毕。`);
  };

  const purifyProgress = useMemo(() => {
    if (purifyQueue.length === 0) return { percent: 0, done: 0, total: 0 };
    const total = purifyQueue.length;
    const done = purifyQueue.filter(i => i.status === 'done' || i.status === 'error').length;
    return { percent: (done / total) * 100, done, total };
  }, [purifyQueue]);

  // Derived filtered and sorted assets
  const getProcessedAssets = (type: 'character' | 'scene') => {
    return assets
      .filter(a => a.type === type)
      .filter(a => {
        if (filterByStatus === 'active') return a.isActive;
        if (filterByStatus === 'inactive') return !a.isActive;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
        if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
        if (sortBy === 'newest') return parseInt(b.id.split('-')[1]) - parseInt(a.id.split('-')[1]);
        if (sortBy === 'oldest') return parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1]);
        if (sortBy === 'status') return (a.isActive === b.isActive) ? 0 : a.isActive ? -1 : 1;
        return 0;
      });
  };

  if (!isLoaded) return null;

  const themeClasses = theme === 'dark' ? 'bg-[#050506] text-[#f2f2f7]' : 'bg-[#f4f4f7] text-[#1d1d1f]';
  const containerClasses = theme === 'dark' ? 'bg-[#0f0f11] border-[#2d2d35] shadow-[0_8px_40px_rgba(0,0,0,0.8)]' : 'bg-white border-[#e2e2e8] shadow-[0_4px_12px_rgba(0,0,0,0.05)]';
  const headerTextClass = theme === 'dark' ? 'text-blue-400 font-bold' : 'text-blue-600 font-bold';
  const labelTextClass = theme === 'dark' ? 'text-white/60' : 'text-black/50';
  const inputBgClass = theme === 'dark' ? 'bg-[#1a1a1e] text-gray-100 border-[#2d2d35]' : 'bg-[#fafafa] text-gray-900 border-[#eef0f2] shadow-inner';
  const scriptEditorClass = theme === 'dark' ? 'bg-[#0a0a0c] text-gray-100 border-[#2a2a32] focus:border-blue-500/60' : 'bg-white text-gray-900 border-[#d1d5db] focus:border-blue-500/50';

  return (
    <div className={`flex flex-col h-screen select-none font-sans overflow-hidden transition-colors duration-500 ${themeClasses}`}>
      <header className={`h-12 flex items-center justify-between px-6 z-50 shrink-0 border-b ${theme === 'dark' ? 'bg-[#0a0a0c] border-white/10' : 'bg-[#1d1d1f] border-black/10'}`}>
        <div className="flex items-center gap-4">
          <div onClick={() => setShowWelcome(true)} className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center font-black text-white text-[9px] cursor-pointer shadow-lg hover:rotate-12 transition-transform">PF</div>
          <h1 className="text-white font-bold text-[10px] tracking-widest italic opacity-95 uppercase">Director Studio <span className="text-blue-500 ml-1">V28.9</span></h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowPurifier(true)} className="text-[8px] font-black text-cyan-400 border border-cyan-400/40 px-3 py-1 rounded-full hover:bg-cyan-400/20 transition-all uppercase">✨ 净化矩阵</button>
          <button onClick={() => setShowTheater(true)} className="text-[8px] font-black text-blue-400 border border-blue-400/40 px-3 py-1 rounded-full hover:bg-blue-400/20 transition-all uppercase">🍿 回放剧场</button>
          <button onClick={toggleTheme} className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all ${theme === 'dark' ? 'bg-white/10 text-yellow-400' : 'bg-black/5 text-gray-400'}`}>
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[230px_1fr_310px] gap-3 p-3 overflow-hidden">
        
        {/* DNA Section */}
        <section className={`rounded-[24px] p-4 flex flex-col gap-4 overflow-hidden border transition-all ${containerClasses} ${valErrStyle ? 'ring-2 ring-red-500 ring-inset animate-pulse bg-red-500/5' : ''}`}>
          <div className="flex justify-between items-center px-1">
             <h2 className={`text-[10px] font-black italic uppercase tracking-widest ${headerTextClass}`}>Visual DNA</h2>
             <div className={`w-2 h-2 rounded-full ${style ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,1)]' : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,1)] animate-ping'}`}></div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto max-h-[16vh] p-0.5 scrollbar-hide">
            {images.map((img, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden group border border-current/10 shadow-md">
                <img src={img} className="w-full h-full object-cover" />
                <button onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-black/80 text-white rounded-full w-4 h-4 text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
              </div>
            ))}
            <button onClick={() => fileInputRef.current?.click()} className={`aspect-square border-2 border-dashed rounded-xl flex items-center justify-center text-sm transition-all ${theme === 'dark' ? 'border-white/20 text-white/20 hover:border-blue-400 hover:text-blue-400' : 'border-gray-200 text-gray-300 hover:border-blue-400 hover:text-blue-400'}`}>+</button>
            <input type="file" ref={fileInputRef} hidden multiple accept="image/*" onChange={(e) => {
              if (e.target.files) Array.from(e.target.files).forEach((file: any) => {
                const reader = new FileReader(); reader.onload = async (ev) => { const comp = await compressImage(ev.target?.result as string); setImages(prev => [...prev, comp]); }; reader.readAsDataURL(file);
              });
            }} />
          </div>
          <button disabled={status === AppStatus.DISTILLING} onClick={handleDistill} className={`w-full py-2.5 rounded-2xl text-[10px] font-black shadow-xl disabled:opacity-30 uppercase tracking-widest active:scale-95 transition-all hover:brightness-110 ${valErrStyle ? 'bg-red-600' : 'bg-blue-600 text-white'}`}>
            {status === AppStatus.DISTILLING ? 'Extracting DNA...' : '启动视觉解构'}
          </button>
          <div className={`flex-1 rounded-[20px] p-4 overflow-y-auto border scrollbar-hide text-[10px] leading-relaxed font-medium ${inputBgClass}`}>
            {style ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">{style.hexCodes.map((hex, i) => <div key={i} className="w-4 h-4 rounded-md border border-black/10 shadow-sm" style={{ background: hex }}></div>)}</div>
                <p className="italic opacity-90 leading-relaxed tracking-tight">{style.summary}</p>
                <div className={`p-2.5 rounded-xl border text-[8px] font-mono opacity-50 leading-tight ${theme === 'dark' ? 'bg-black/50 border-white/10' : 'bg-white border-gray-100'}`}>{style.technicalParams}</div>
              </div>
            ) : <p className={`opacity-40 italic text-center mt-10 uppercase tracking-[0.2em] font-black ${labelTextClass} ${valErrStyle ? 'text-red-500 animate-pulse' : ''}`}>DNA Queue Empty</p>}
          </div>
        </section>

        {/* Studio Section */}
        <section className={`rounded-[24px] p-4 flex flex-col gap-4 overflow-hidden border transition-all ${containerClasses}`}>
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            
            {/* Scenario Editor */}
            <div className={`flex-[7] flex flex-col gap-2 min-h-[250px] relative transition-all ${valErrScript ? 'ring-2 ring-red-500 rounded-[22px] bg-red-500/5 animate-pulse' : ''}`}>
              <div className="flex justify-between items-center px-1">
                 <span className={`text-[10px] font-black uppercase tracking-[0.3em] italic ${headerTextClass}`}>Scenario Studio</span>
                 <div className="flex gap-1.5">{[1,2,3].map(i=><div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500/40"></div>)}</div>
              </div>
              <textarea 
                value={script} 
                onChange={(e) => setScript(e.target.value)} 
                placeholder="在此粘贴您的动漫剧本内容..." 
                className={`flex-1 rounded-[22px] p-6 text-sm outline-none resize-none font-medium transition-all border leading-relaxed shadow-lg ${scriptEditorClass} placeholder:opacity-30 ${valErrScript ? 'border-red-500 focus:border-red-500' : ''}`} 
              />
              <div className="absolute bottom-6 right-8 opacity-[0.05] font-black text-3xl italic pointer-events-none tracking-tighter uppercase">Director Mode</div>
            </div>

            {/* Asset Vault */}
            <div className={`flex-[3.5] rounded-[22px] p-4 border flex flex-col overflow-hidden min-h-[160px] ${inputBgClass}`}>
               <div className="flex flex-col gap-3 mb-3 shrink-0">
                  <div className="flex justify-between items-center px-1">
                    <div className="flex gap-3 items-center">
                      <span className={`text-[10px] font-black uppercase tracking-widest italic ${headerTextClass}`}>Asset Vault</span>
                      <div className="flex gap-2">
                          <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowAssetCreator({type: 'character'})} className="text-[7.5px] font-black text-blue-500 bg-blue-500/15 px-3 py-1 rounded-full hover:bg-blue-500/30 transition-all uppercase">+ 角色</button>
                          <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowAssetCreator({type: 'scene'})} className="text-[7.5px] font-black text-purple-500 bg-purple-500/15 px-3 py-1 rounded-full hover:bg-purple-500/30 transition-all uppercase">+ 场景</button>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center px-1 py-1.5 border-y border-current/5 gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] font-black uppercase opacity-40">排序方式:</span>
                      <select 
                        value={sortBy} 
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className={`text-[8px] font-black bg-transparent outline-none border-none transition-colors cursor-pointer ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}
                      >
                        <option value="newest">最新添加</option>
                        <option value="oldest">最早添加</option>
                        <option value="name-asc">名称 (A-Z)</option>
                        <option value="name-desc">名称 (Z-A)</option>
                        <option value="status">激活状态</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[7px] font-black uppercase opacity-40 mr-1">状态筛选:</span>
                      {(['all', 'active', 'inactive'] as FilterOption[]).map(f => (
                        <button 
                          key={f} 
                          onClick={() => setFilterByStatus(f)}
                          className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-md transition-all ${filterByStatus === f ? 'bg-blue-600 text-white shadow-md' : 'opacity-40 hover:opacity-100'}`}
                        >
                          {f === 'all' ? '全部' : f === 'active' ? '已激活' : '已停用'}
                        </button>
                      ))}
                    </div>
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto pr-1 pb-1 scrollbar-hide space-y-5">
                 {['character', 'scene'].map(type => {
                   const processedAssets = getProcessedAssets(type as any);
                   return (
                     <div key={type}>
                       <h4 className={`text-[8.5px] font-black uppercase mb-3 tracking-[0.2em] px-1 ${theme === 'dark' ? 'text-white/60' : 'text-black/40'}`}>
                         {type === 'character' ? '角色资产' : '场景资产'} 
                         <span className="ml-2 opacity-30 text-[7px]">({processedAssets.length})</span>
                       </h4>
                       <div className="grid grid-cols-6 md:grid-cols-9 lg:grid-cols-11 gap-3 px-0.5">
                         {processedAssets.map(asset => {
                           const isBeingDragged = draggedAssetId === asset.id;
                           const isDropTarget = dragOverAssetId === asset.id;
                           
                           return (
                             <div 
                               key={asset.id} 
                               draggable="true"
                               onDragStart={(e) => handleDragStart(e, asset.id)}
                               onDragOver={(e) => handleDragOver(e, asset.id)}
                               onDragLeave={handleDragLeave}
                               onDragEnd={handleDragEnd}
                               onDrop={(e) => handleDrop(e, asset.id)}
                               className={`group relative p-0.5 rounded-xl border transition-all duration-300 cursor-grab active:cursor-grabbing 
                                 ${isBeingDragged ? 'opacity-30 border-blue-500 scale-95' : 'opacity-100'} 
                                 ${isDropTarget ? 'border-cyan-400 border-2 scale-105 shadow-[0_0_15px_rgba(34,211,238,0.5)] z-20' : ''}
                                 ${!isBeingDragged && !isDropTarget ? (asset.isActive ? (type === 'character' ? 'border-blue-500/70 bg-blue-500/10' : 'border-purple-500/70 bg-purple-500/10') : 'border-transparent bg-black/20 opacity-60 grayscale') : ''}`}
                             >
                               <img src={asset.images.find(i=>i.isActive)?.url || asset.images[0]?.url} className="aspect-square rounded-lg object-cover mb-1 shadow-md pointer-events-none" />
                               <p className={`text-[7px] font-black truncate text-center uppercase tracking-tight pointer-events-none ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{asset.name}</p>
                               
                               <div className="absolute inset-0 bg-black/95 backdrop-blur-[3px] rounded-xl flex flex-col items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-[100] p-1.5">
                                  <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openAssetEditor(asset); }} className="w-full py-1.5 text-[8.5px] font-black uppercase rounded-lg text-white bg-blue-600 hover:bg-blue-500 transition-colors shadow-lg">修改</button>
                                  <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleAssetStatus(asset.id); }} className={`w-full py-1.5 text-[8.5px] font-black uppercase rounded-lg border transition-colors ${asset.isActive ? 'text-orange-400 border-orange-400/40 bg-orange-400/5 hover:bg-orange-400/20' : 'text-green-400 border-green-400/40 bg-green-400/5 hover:bg-green-400/20'}`}>
                                    {asset.isActive ? '停用' : '激活'}
                                  </button>
                                  <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setAssetToDelete(asset); }} className="w-full py-1.5 text-[8.5px] font-black uppercase rounded-lg text-red-500 border border-red-500/30 bg-red-500/5 hover:bg-red-500/20 transition-colors">删除</button>
                               </div>
                               {isDropTarget && (
                                 <div className="absolute -inset-1 border-2 border-cyan-400 border-dashed rounded-2xl pointer-events-none animate-pulse"></div>
                               )}
                             </div>
                           );
                         })}
                       </div>
                       {processedAssets.length === 0 && (
                         <div className="text-[7px] italic opacity-20 uppercase px-1 py-2">未找到匹配的{type === 'character' ? '角色' : '场景'}</div>
                       )}
                     </div>
                   );
                 })}
                 {assets.length === 0 && <div className="text-[10px] text-center opacity-10 uppercase font-black py-8 tracking-widest italic">库中空空如也</div>}
               </div>
            </div>

            <div className={`h-12 rounded-[16px] p-2.5 font-mono text-[9px] overflow-y-auto scrollbar-hide border ${theme === 'dark' ? 'bg-[#000] text-blue-400/90 border-white/5' : 'bg-gray-900 text-green-400/90 border-black/5'}`}>
              {directorLog.map((l, i) => <div key={i} className="mb-1 opacity-95 text-xs">{l}</div>)}
            </div>
            
            <div className="flex gap-3 items-center">
              <div className={`flex rounded-2xl p-1 border transition-all overflow-x-auto scrollbar-hide ${theme === 'dark' ? 'bg-[#1a1a1e] border-white/10 shadow-inner' : 'bg-gray-200/50 border-gray-200 shadow-inner'}`}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <button key={n} onClick={() => setShotCount(n)} className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all min-w-[36px] ${shotCount === n ? 'bg-blue-600 text-white shadow-xl' : 'text-current opacity-40 hover:opacity-100'}`}>
                    {n}
                  </button>
                ))}
              </div>
              <button disabled={status === AppStatus.DEDUCTING} onClick={handleDeduct} className={`flex-1 bg-blue-600 text-white py-4 rounded-2xl text-[11px] font-black shadow-2xl transition-all uppercase tracking-[0.3em] active:scale-95 hover:brightness-110 shadow-blue-500/30`}>
                {status === AppStatus.DEDUCTING ? 'Processing Pipeline...' : '启动分镜推演'}
              </button>
            </div>
          </div>
        </section>

        {/* Output Section */}
        <section className={`rounded-[24px] p-4 flex flex-col gap-4 overflow-hidden border transition-all ${containerClasses}`}>
          <div className="flex justify-between items-center px-1">
            <h2 className={`text-[10px] font-black italic uppercase tracking-widest ${headerTextClass}`}>Output Terminal</h2>
            <div className="flex gap-2">
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className={`text-[8px] font-black px-2 py-1 rounded-lg outline-none border transition-all ${theme === 'dark' ? 'bg-[#1a1a1e] text-white border-white/20' : 'bg-white text-gray-700 border-gray-200 shadow-sm'}`}>
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="4:3">4:3</option>
                </select>
                <button onClick={() => setShots([])} className="text-[8px] font-black text-red-500 bg-red-500/10 px-2.5 py-1 rounded-lg transition-all uppercase hover:bg-red-500/20 border border-red-500/20">Clear</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-5 pr-1 scrollbar-hide pb-10">
            {shots.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center opacity-10 italic">
                    <span className="text-4xl mb-4">🎬</span>
                    <p className="text-[10px] font-black uppercase tracking-[0.4em]">Awaiting Production</p>
                </div>
            )}
            {shots.map((shot) => (
              <div key={shot.id} className={`rounded-[20px] p-4.5 border transition-all group/shot ${theme === 'dark' ? 'bg-[#16161a] border-white/10 shadow-2xl' : 'bg-[#fafafa] border-gray-200 shadow-sm'} ${shot.id.startsWith('placeholder-') ? 'animate-pulse opacity-50' : ''}`}>
                <div className="flex justify-between items-center mb-2.5">
                  <span className={`font-black text-[9px] uppercase tracking-[0.3em] ${theme === 'dark' ? 'text-white/60' : 'text-black/40'}`}>{shot.name}</span>
                  {!shot.id.startsWith('placeholder-') && (
                    <div className="flex gap-2.5 opacity-0 group-hover/shot:opacity-100 transition-all">
                      <button onClick={() => { if(shot.imageUrl) downloadShot(shot.imageUrl, shot.name); }} className="text-blue-500 hover:text-blue-400 text-[9px] font-black uppercase">保存</button>
                      <button onClick={() => { if(shot.imageUrl) { setPurifyQueue(prev => [...prev, { id: `pur-${Date.now()}`, input: shot.imageUrl!, status: 'pending' }]); setShowPurifier(true); } }} className="text-cyan-500 hover:text-cyan-400 text-[9px] font-black uppercase">✨ 净化</button>
                      <button onClick={() => { setShots(prev => prev.filter(s => s.id !== shot.id)); }} className="text-red-400 text-xs">×</button>
                    </div>
                  )}
                </div>
                <p className={`text-[11px] mb-4 leading-relaxed font-bold italic tracking-tight ${theme === 'dark' ? 'text-white/95' : 'text-gray-800'}`}>{shot.chineseDescription}</p>
                <div className={`relative rounded-2xl overflow-hidden aspect-video border shadow-inner ${theme === 'dark' ? 'bg-black border-white/10' : 'bg-zinc-100 border-gray-200'}`}>
                  {shot.imageUrl ? (
                    <img src={shot.imageUrl} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center animate-pulse gap-3 text-blue-600/40">
                      <div className="w-5 h-5 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
                      <span className="text-[8px] font-black uppercase tracking-[0.4em] italic">Rendering Frame</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* 资产物理删除确认矩阵 - 自定义模态框 */}
      {assetToDelete && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-3xl z-[10000] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className={`rounded-[32px] w-full max-w-md p-10 shadow-2xl border-2 flex flex-col items-center text-center transition-all ${theme === 'dark' ? 'bg-[#1a0a0a] border-red-500/50 shadow-red-500/20' : 'bg-white border-red-200 shadow-xl'}`}>
              <div className="w-20 h-20 rounded-full bg-red-600/10 flex items-center justify-center mb-6 border border-red-500/30">
                <span className="text-red-500 text-4xl animate-pulse">⚠️</span>
              </div>
              <h3 className="text-2xl font-black italic uppercase tracking-tighter text-red-500 mb-4">资产物理清除警告</h3>
              <p className={`text-[11px] font-bold uppercase tracking-widest leading-relaxed mb-8 opacity-70 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
                您正准备永久销毁资产 <span className="text-red-500 underline font-black">"{assetToDelete.name}"</span>。<br/>此操作将不可逆转地抹除其在核心库及本地 DNA 链中的所有记录。
              </p>
              
              <div className="flex gap-4 w-full">
                <button onClick={() => setAssetToDelete(null)} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${theme === 'dark' ? 'border-white/10 text-white/50 hover:bg-white/5' : 'border-black/5 text-black/40 hover:bg-gray-50'}`}>中止清除</button>
                <button onClick={() => performDeleteAsset(assetToDelete.id)} className="flex-1 bg-red-600 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl shadow-red-500/30 hover:bg-red-500 transition-all active:scale-95">执行物理抹除</button>
              </div>
              
              <div className="mt-8 pt-4 border-t border-red-500/10 w-full">
                <p className="text-[7px] text-red-500/40 uppercase font-mono tracking-tighter animate-pulse">[PROTOCOL 00: DATA PURGE INITIATED]</p>
              </div>
           </div>
        </div>
      )}

      {/* Asset Creator / Editor Modal */}
      {showAssetCreator && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-3xl z-[6000] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`rounded-[32px] w-full max-w-2xl p-10 shadow-2xl transition-all border flex flex-col max-h-[90vh] ${theme === 'dark' ? 'bg-[#151518] border-white/20' : 'bg-white border-black/10'}`}>
            <div className="flex justify-between items-center mb-10 shrink-0">
              <h3 className={`text-2xl font-black italic uppercase tracking-tighter ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
                {showAssetCreator.editId ? '资产配置重组' : `录入新${showAssetCreator.type === 'character' ? '角色' : '场景'}`}
              </h3>
              <button onClick={() => setShowAssetCreator(null)} className="text-3xl font-light hover:rotate-90 transition-transform opacity-60 hover:opacity-100">×</button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide space-y-10 pb-6">
              <div>
                <label className={`text-[9px] font-black uppercase block mb-3 px-1 tracking-widest ${theme === 'dark' ? 'text-white/60' : 'text-black/40'}`}>资产代号 (ID)</label>
                <input value={newAssetName} onChange={(e) => setNewAssetName(e.target.value)} placeholder="输入名称标识..." className={`w-full px-6 py-5 rounded-2xl border outline-none font-bold text-base ${inputBgClass} placeholder:opacity-20`} />
              </div>
              
              <div>
                <label className={`text-[9px] font-black uppercase block mb-4 px-1 tracking-widest ${theme === 'dark' ? 'text-white/60' : 'text-black/40'}`}>视觉基因组 (Photo Management)</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 mb-5">
                  {newAssetImages.map((img, i) => (
                    <div key={i} className={`group aspect-square rounded-2xl overflow-hidden border-2 relative shadow-xl transition-all ${img.isActive ? 'border-blue-500/70' : 'border-red-500/50 grayscale opacity-40'}`}>
                      <img src={img.url} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity p-3">
                         <button onClick={() => setNewAssetImages(prev => prev.map((item, idx) => idx === i ? { ...item, isActive: !item.isActive } : item))} className={`w-full py-2.5 rounded-xl text-[9px] font-black uppercase transition-colors shadow-lg ${img.isActive ? 'bg-orange-600 text-white' : 'bg-green-600 text-white'}`}>
                           {img.isActive ? '停用此图' : '启用此图'}
                         </button>
                         <button onClick={() => setNewAssetImages(prev => prev.filter((_, idx) => idx !== i))} className="w-full py-2.5 rounded-xl text-[9px] font-black uppercase bg-red-600 text-white hover:bg-red-700 transition-colors shadow-lg">彻底删除此图</button>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => assetImageInputRef.current?.click()} className={`aspect-square border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all ${theme === 'dark' ? 'border-white/20 text-white/20 hover:border-blue-500/70 hover:text-blue-400' : 'border-gray-200 text-gray-300 hover:border-blue-400 hover:text-blue-400'}`}>
                    <span className="text-4xl mb-1.5">+</span>
                    <span className="text-[9px] uppercase font-black tracking-widest">追加基因样本</span>
                  </button>
                  <input type="file" ref={assetImageInputRef} hidden multiple accept="image/*" onChange={(e) => { 
                    if (e.target.files) Array.from(e.target.files).forEach((file: any) => { 
                      const reader = new FileReader(); 
                      reader.onload = async (ev) => { 
                        const comp = await compressImage(ev.target?.result as string, 512, 0.5); 
                        setNewAssetImages(prev => [...prev, { url: comp, isActive: true }]); 
                      }; 
                      reader.readAsDataURL(file); 
                    }); 
                  }} />
                </div>
              </div>

              {showAssetCreator.editId && (
                <div className={`p-6 rounded-3xl border border-red-500/20 bg-red-500/5 mt-10 transition-all hover:bg-red-500/10`}>
                   <div className="flex justify-between items-center">
                      <div>
                        <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">危险区域</h4>
                        <p className="text-[8px] text-red-400 opacity-60 uppercase">彻底移除此资产及其所有视觉基因</p>
                      </div>
                      <button onClick={() => setAssetToDelete(assets.find(a => a.id === showAssetCreator.editId!) || null)} className="bg-red-600 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-red-700 active:scale-95 transition-all shadow-xl">销毁资产</button>
                   </div>
                </div>
              )}
            </div>

            <div className="flex gap-5 pt-10 border-t border-current/10 shrink-0">
              <button onClick={() => { setShowAssetCreator(null); setNewAssetImages([]); setNewAssetName(''); }} className={`flex-1 py-5 text-[11px] font-black uppercase tracking-widest transition-opacity ${theme === 'dark' ? 'text-white/60' : 'text-black/40'} hover:opacity-100`}>放弃更改</button>
              <button onClick={saveAsset} className="flex-[2] bg-blue-600 text-white py-5 rounded-2xl text-[11px] font-black uppercase shadow-2xl shadow-blue-500/40 active:scale-95 transition-all hover:brightness-110">确认并同步库</button>
            </div>
          </div>
        </div>
      )}

      {/* Purification Matrix Modal */}
      {showPurifier && (
        <div className={`fixed inset-0 z-[10000] flex flex-col p-10 animate-in fade-in transition-all ${theme === 'dark' ? 'bg-[#050506] text-[#f0f0f7]' : 'bg-white text-gray-900'}`}>
           <div className={`h-16 flex items-center justify-between px-2 border-b transition-colors shrink-0 ${theme === 'dark' ? 'border-white/20' : 'border-black/5'}`}>
             <h3 className="text-2xl font-black italic uppercase tracking-tighter">Purification Matrix / 净化引擎</h3>
             <button onClick={() => setShowPurifier(false)} className="text-4xl font-light hover:rotate-90 transition-transform opacity-60">×</button>
          </div>
          <div className="flex-1 flex gap-10 overflow-hidden mt-10">
             <div className="w-72 flex flex-col gap-8">
                <div className={`p-6 rounded-[32px] border flex flex-col gap-3 transition-all ${theme === 'dark' ? 'bg-[#1a1a1e] border-white/20' : 'bg-gray-50 border-gray-200'}`}>
                   <div className="flex justify-between items-center px-1">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-white/50' : 'text-black/30'}`}>Batch Progress</span>
                      <span className="text-[10px] font-black text-cyan-500">{purifyProgress.done}/{purifyProgress.total}</span>
                   </div>
                   <div className="h-2 rounded-full bg-current/10 overflow-hidden relative">
                      <div className="absolute inset-0 h-full bg-cyan-500/20 transition-all duration-1000"></div>
                      <div className="h-full bg-cyan-500 transition-all duration-700 shadow-[0_0_10px_rgba(6,182,212,0.6)]" style={{ width: `${purifyProgress.percent}%` }}></div>
                   </div>
                </div>

                <button onClick={() => purifierInputRef.current?.click()} className={`w-full aspect-square border-2 border-dashed rounded-[48px] flex flex-col items-center justify-center transition-all ${theme === 'dark' ? 'border-white/30 text-white/30 hover:bg-white/5 hover:border-blue-500/50 hover:text-blue-400' : 'border-gray-200 text-gray-200 hover:bg-gray-50'}`}>
                   <span className="text-5xl mb-3">+</span>
                   <span className="text-[11px] font-black uppercase tracking-widest">录入待处理样本</span>
                </button>
                <input type="file" ref={purifierInputRef} hidden multiple accept="image/*" onChange={(e) => {
                  if (e.target.files) Array.from(e.target.files).forEach((file: any) => {
                    const reader = new FileReader(); reader.onload = async (ev) => { setPurifyQueue(prev => [...prev, { id: `pur-${Date.now()}-${Math.random()}`, input: ev.target?.result as string, status: 'pending' }]); }; reader.readAsDataURL(file);
                  });
                }} />
                
                <button disabled={isPurifyingBatch || purifyQueue.filter(i => i.status === 'pending').length === 0} onClick={handlePurifyBatch} className="w-full bg-cyan-500 text-black py-5 rounded-3xl font-black text-[12px] uppercase shadow-2xl disabled:opacity-20 active:scale-95 transition-all hover:brightness-110">
                  {isPurifyingBatch ? '并发执行中...' : '启动并发净化'}
                </button>

                <div className={`flex-1 rounded-[40px] p-6 overflow-y-auto border scrollbar-hide shadow-inner ${theme === 'dark' ? 'bg-[#16161a] border-white/10' : 'bg-gray-100 border-gray-200'}`}>
                   <div className="space-y-3">
                      {purifyQueue.map(item => (
                         <div key={item.id} className={`flex items-center gap-4 p-3 rounded-2xl border ${theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-black/5 bg-black/5'}`}>
                            <img src={item.input} className="w-10 h-10 rounded-xl object-cover opacity-90 shadow-md" />
                            <div className="flex-1 h-1.5 rounded-full bg-current/20 overflow-hidden relative">
                               <div className={`h-full transition-all duration-1000 ${item.status === 'done' ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)]' : item.status === 'working' ? 'bg-cyan-500 animate-pulse' : item.status === 'error' ? 'bg-red-500' : 'w-0'}`} style={{ width: item.status === 'done' || item.status === 'error' ? '100%' : item.status === 'working' ? '65%' : '0' }}></div>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>
             </div>
             <div className="flex-1 grid grid-cols-2 gap-8 overflow-y-auto pr-3 scrollbar-hide pb-16">
                {purifyQueue.filter(i => i.status === 'done' || i.status === 'working' || i.status === 'error').map(item => (
                   <div key={item.id} className={`rounded-[48px] p-10 border flex flex-col gap-6 animate-in zoom-in ${theme === 'dark' ? 'bg-[#1a1a1e] border-white/20 shadow-2xl' : 'bg-[#fafafa] border-gray-200 shadow-md'}`}>
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-black text-cyan-400 uppercase tracking-widest italic drop-shadow-md">Matrix Output</span>
                        {item.output && <button onClick={() => downloadShot(item.output!, 'purified')} className="text-[10px] font-black text-white bg-blue-600 px-5 py-2 rounded-full shadow-lg hover:brightness-110 transition-all">导出无损成品</button>}
                      </div>
                      <div className="grid grid-cols-2 gap-10">
                         <div className="space-y-4 text-center">
                            <img src={item.input} className={`rounded-3xl w-full aspect-square object-cover border ${theme === 'dark' ? 'opacity-40 border-white/10' : 'opacity-30 grayscale border-black/5'}`} />
                            <p className={`text-[9px] font-black uppercase ${theme === 'dark' ? 'text-white/60' : 'text-black/40'}`}>Raw Frame</p>
                         </div>
                         <div className="space-y-4 text-center">
                            <div className={`relative aspect-square rounded-3xl overflow-hidden border-2 ${theme === 'dark' ? 'bg-[#000] border-white/30 shadow-[inset_0_4px_20px_rgba(0,0,0,1)]' : 'bg-white border-gray-200 shadow-inner'}`}>
                               {item.output ? (
                                 <img src={item.output} className="w-full h-full object-cover" />
                               ) : item.status === 'error' ? (
                                 <div className="w-full h-full flex items-center justify-center text-red-500 font-black text-[10px] uppercase">Failed</div>
                               ) : (
                                 <div className="w-full h-full flex flex-col items-center justify-center animate-pulse gap-3">
                                   <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
                                   <span className="text-[8px] text-cyan-500/70 uppercase font-black">Synthesizing...</span>
                                 </div>
                               )}
                            </div>
                            <p className="text-[9px] font-black text-cyan-500 uppercase tracking-[0.2em]">Purified Result</p>
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        </div>
      )}

      {/* Theater View */}
      {showTheater && (
        <div className="fixed inset-0 bg-[#010102] z-[20000] flex flex-col animate-in zoom-in duration-300">
          <div className="h-16 flex items-center justify-between px-12 border-b border-white/10 bg-black/80 backdrop-blur-3xl shrink-0">
             <span className="text-blue-500 font-black italic tracking-[0.8em] text-[12px] uppercase">Theater Simulation Mode</span>
             <button onClick={() => setShowTheater(false)} className="text-white/30 hover:text-white text-4xl font-light transition-all hover:rotate-90">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-16 space-y-40 scrollbar-hide pb-80">
             {shots.filter(s => !s.id.startsWith('placeholder-')).map((shot, i) => (
               <div key={shot.id} className="max-w-5xl mx-auto space-y-12 group">
                  <div className="flex items-start gap-12">
                     <span className="text-[120px] font-black text-white/5 font-mono select-none leading-none group-hover:text-blue-500/10 transition-colors">0{i+1}</span>
                     <div className="pt-8">
                        <h4 className="text-[12px] font-black text-blue-500 uppercase tracking-[0.5em] mb-5">{shot.name}</h4>
                        <p className="text-5xl font-bold text-white leading-tight italic tracking-tight drop-shadow-2xl">{shot.chineseDescription}</p>
                     </div>
                  </div>
                  <div className="aspect-video bg-zinc-950 rounded-[64px] overflow-hidden shadow-[0_80px_180px_rgba(0,0,0,1)] border border-white/20 relative transition-transform duration-1000 group-hover:scale-[1.015]">
                     {shot.imageUrl ? (
                        <>
                          <img src={shot.imageUrl} className="w-full h-full object-cover" />
                          <button onClick={() => downloadShot(shot.imageUrl!, shot.name)} className="absolute bottom-10 right-12 bg-blue-600/95 backdrop-blur-2xl text-white text-[12px] font-black px-12 py-6 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95 shadow-2xl uppercase tracking-[0.3em]">同步至本地</button>
                        </>
                     ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white/5 uppercase font-black tracking-widest italic animate-pulse gap-5"><div className="w-16 h-16 border-4 border-white/5 border-t-blue-600 rounded-full animate-spin"></div>Rendering Media...</div>
                     )}
                  </div>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* Welcome Screen */}
      {showWelcome && (
        <div className="fixed inset-0 bg-[#050506] z-[3000] flex flex-col items-center justify-center p-6 text-white text-center">
          <div className="max-w-xl animate-in fade-in slide-in-from-bottom-12 duration-1000">
            <div className="w-28 h-28 bg-blue-600 rounded-[36px] mx-auto mb-12 flex items-center justify-center text-5xl font-black shadow-[0_30px_60px_rgba(37,99,235,0.4)] hover:scale-110 transition-transform cursor-pointer">PF</div>
            <h1 className="text-5xl font-black mb-6 italic tracking-[0.2em] uppercase drop-shadow-lg">PromptFlow Studios</h1>
            <p className="text-white/40 text-[11px] mb-16 font-black tracking-[0.5em] uppercase">Cinematic Anime Generation Core</p>
            <div className="space-y-6 w-80 mx-auto">
               <button onClick={() => setShowWelcome(false)} className="w-full bg-white text-black py-5 rounded-2xl font-black text-[13px] uppercase tracking-[0.4em] shadow-2xl hover:bg-blue-600 hover:text-white transition-all active:scale-95">启动生产中枢</button>
               <button onClick={checkApiKey} className={`w-full py-4.5 rounded-2xl font-black text-[11px] border transition-all uppercase tracking-widest ${hasApiKey ? 'border-green-500/50 text-green-500 bg-green-500/10 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-white/20 text-white/30 hover:border-white/40'}`}>
                 {hasApiKey ? '✓ API Node Online' : 'Connect API Cluster'}
               </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .animate-in { animation: animate-in 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes animate-in { from { opacity: 0; transform: translateY(30px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        ::selection { background: #2563eb; color: white; }
        body { overflow: hidden; height: 100vh; background-color: ${theme === 'dark' ? '#050506' : '#f4f4f7'}; }
        textarea { caret-color: #2563eb; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 10px; }
        .dark ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); }
        input, textarea { outline: none !important; }
        select { -webkit-appearance: none; -moz-appearance: none; appearance: none; }
      `}</style>
    </div>
  );
};

export default App;
