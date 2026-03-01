/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Send, Bot, User, Sparkles, Loader2, Trash2, Languages, Volume2, VolumeX, Home, History, Plus, ChevronRight, ArrowLeft, Clock, Mail, Lock, Facebook, LogOut, Users, MessageSquare, Settings, Download, Play, Mic } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { io, Socket } from 'socket.io-client';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  gender?: 'male' | 'female';
}

interface Message {
  role: 'user' | 'model';
  content: string;
  id: string;
  audio?: string; // Base64 audio data
  image?: string; // Base64 image data
  senderName?: string;
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

const SYSTEM_INSTRUCTION = `ንስኻ "ትግርኛ AI" ኢኻ። ንጹርን ቅኑዕን ትግርኛ ጥራይ ኢኻ እትዛረብ። 
ቀንዲ ቋንቋኻ ትግርኛ ኮይኑ፡ ኩሉ ግዜ ብፊደላት ግዕዝ ኢኻ እትጽሕፍ። 
መልስታትካ ንጹር፡ ሕጽር ዝበለ፡ ከምኡ እውን ንባህሊ ኤርትራን ኢትዮጵያን ዘኽብር ክኸውን ኣለዎ። 
ሓቀኛን እዋናውን ሓበሬታ ንምሃብ Google Search ተጠቐም። 
ተጠቓሚ ብኻልእ ቋንቋ እንተተዛሪቡካ፡ ብትግርኛ እናመለስካ ትርጉሙ ክትህቦ ትኽእል ኢኻ።`;

const SESSIONS_STORAGE_KEY = 'tigrinya_ai_sessions_v2';

export default function App() {
  const [view, setView] = useState<'landing' | 'login' | 'onboarding' | 'home' | 'chat' | 'private-chat' | 'live'>('landing');
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<{ role: string, text: string }[]>([]);
  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<'Kore' | 'Fenrir'>('Kore');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [privateMessages, setPrivateMessages] = useState<Message[]>([]);
  const [roomUsers, setRoomUsers] = useState<UserProfile[]>([]);
  const [aiEnabledInPrivate, setAiEnabledInPrivate] = useState(false);
  const [roomId, setRoomId] = useState('general');
  const [roomName, setRoomName] = useState('ብሕታዊ ቻት');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInstance = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Helper to convert raw PCM to a playable WAV URL
  const pcmToWavUrl = (pcmBase64: string, sampleRate: number = 24000) => {
    try {
      const binaryString = window.atob(pcmBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const wavHeader = new ArrayBuffer(44);
      const view = new DataView(wavHeader);

      const writeString = (v: DataView, offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          v.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      // RIFF chunk descriptor
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + len, true);
      writeString(view, 8, 'WAVE');

      // fmt sub-chunk
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // Mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);

      // data sub-chunk
      writeString(view, 36, 'data');
      view.setUint32(40, len, true);

      const blob = new Blob([wavHeader, bytes], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("PCM to WAV conversion failed", e);
      return null;
    }
  };

  // Load sessions from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSessions(parsed);
      } catch (e) {
        console.error("Failed to parse sessions", e);
      }
    }
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        // Strip audio data to save space in localStorage (quota limit)
        const sessionsToSave = sessions.map(session => ({
          ...session,
          messages: session.messages.map(({ audio, ...rest }) => rest)
        }));
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessionsToSave));
      } catch (e) {
        console.error("Failed to save sessions", e);
      }
    }
  }, [sessions]);

  // Update current session messages when they change
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, messages, updatedAt: Date.now(), title: messages[0]?.content.slice(0, 30) || s.title } 
          : s
      ));
    }
  }, [messages, currentSessionId]);

  // Socket connection for private chat
  useEffect(() => {
    if (user && view === 'private-chat') {
      const newSocket = io();
      setSocket(newSocket);

      newSocket.emit('join-room', { roomId, user });

      newSocket.on('room-update', (room) => {
        setRoomUsers(room.users);
        setPrivateMessages(room.messages);
        setAiEnabledInPrivate(room.aiEnabled);
      });

      newSocket.on('new-message', (message) => {
        setPrivateMessages(prev => [...prev, message]);
      });

      newSocket.on('ai-status-update', (enabled) => {
        setAiEnabledInPrivate(enabled);
      });

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user, view, roomId]);
  // Initialize Gemini Chat
  useEffect(() => {
    if (view === 'chat' || (view === 'private-chat' && aiEnabledInPrivate)) {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      chatInstance.current = ai.chats.create({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction: SYSTEM_INSTRUCTION + (user?.gender ? `\nThe user is ${user.gender}.` : ""),
          tools: [{ googleSearch: {} }],
        },
      });
    }
  }, [view, currentSessionId, aiEnabledInPrivate, user]);

  const createNewSession = () => {
    const newId = Date.now().toString();
    const newSession: Session = {
      id: newId,
      title: "ሓድሽ ዝርርብ",
      messages: [],
      updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    setMessages([]);
    setView('chat');
  };

  const loadSession = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setMessages(session.messages);
      setView('chat');
    }
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm("ነዚ ዝርርብ ክድምስሶ ርግጸኛ ዲኻ?")) {
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([]);
        setView('home');
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const generateSpeech = async (text: string, retryCount = 0): Promise<string | null> => {
    try {
      // Strip markdown for cleaner TTS
      const cleanText = text.replace(/[*_#`~>]/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
      if (!cleanText) return null;

      // Check if we should use a custom API key if available
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      // Robustly find the audio part in the response
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.data && part.inlineData.mimeType?.includes('audio')) {
            return part.inlineData.data;
          }
          // Fallback if mimeType is missing but data exists
          if (part.inlineData?.data) {
            return part.inlineData.data;
          }
        }
      }
      return null;
    } catch (error: any) {
      console.error("Speech generation failed:", error);
      const errorMsg = error.message || "";
      
      // If quota exceeded, check if user wants to select their own key
      if (errorMsg.includes("quota") || errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        // Retry once with a small delay
        if (retryCount < 1) {
          console.log("Quota exceeded, retrying in 2 seconds...");
          await new Promise(resolve => setTimeout(resolve, 2000));
          return generateSpeech(text, retryCount + 1);
        }

        // If still failing, suggest selecting a key
        const useOwnKey = confirm("ይቕሬታ፡ ናይቲ ነጻ ኣገልግሎት ድምጺ ደረት (Quota) ተወዲኡ ኣሎ። ናትካ ናይ ክፍሊት (Paid) API Key ክትጥቀም ትደሊዶ?\n\n(Would you like to select your own API key to continue?)");
        
        if (useOwnKey && (window as any).aistudio) {
          try {
            await (window as any).aistudio.openSelectKey();
            // After selecting key, the app will use process.env.API_KEY automatically in next calls
            alert("API Key ተመሪጹ ኣሎ። በጃኹም ሕጂ ደጊምኩም 'ስማዕ' ዝብል ጠውቑ።");
          } catch (e) {
            console.error("Failed to open key selector", e);
          }
        } else {
          alert("ይቕሬታ፡ ናይ ድምጺ ኣገልግሎት ንግዚኡ ተወዲኡ ኣሎ። በጃኹም ድሕሪ ቁሩብ ደቓይቕ ደጊምኩም ፈትኑ።");
        }
      } else if (errorMsg.includes("500") || errorMsg.includes("INTERNAL")) {
        alert("ይቕሬታ፡ ኣብቲ ሰርቨር ናይ ቴክኒክ ጸገም ኣጋጢሙ ኣሎ። በጃኹም ደሓር ፈትኑ።");
      } else {
        alert("ይቕሬታ፡ ድምጺ ኣብ ምድላው ጸገም ተፈጢሩ። በጃኹም ኢንተርነትኩም ኣረጋግጹ።");
      }
      return null;
    }
  };

  const playAudio = (base64Data: string, messageId: string) => {
    try {
      // If already speaking this message, stop it
      if (isSpeaking === messageId && audioRef.current) {
        audioRef.current.pause();
        setIsSpeaking(null);
        return;
      }

      if (audioRef.current) {
        audioRef.current.pause();
        // Clean up previous URL if it was a blob
        if (audioRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(audioRef.current.src);
        }
      }
      
      const audioUrl = pcmToWavUrl(base64Data);
      if (!audioUrl) return;
      
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      setIsSpeaking(messageId);
      
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error("Playback failed:", error);
          setIsSpeaking(null);
        });
      }
      
      audio.onended = () => {
        setIsSpeaking(null);
        URL.revokeObjectURL(audioUrl);
      };
    } catch (error) {
      console.error("Error setting up audio:", error);
      setIsSpeaking(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      id: Date.now().toString(),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    const modelMessageId = (Date.now() + 1).toString();
    const modelMessage: Message = {
      role: 'model',
      content: '',
      id: modelMessageId,
    };
    
    setMessages(prev => [...prev, modelMessage]);

    try {
      const stream = await chatInstance.current.sendMessageStream({ message: currentInput });
      let fullText = '';
      
      for await (const chunk of stream) {
        const chunkText = chunk.text || '';
        fullText += chunkText;
        setMessages(prev => prev.map(m => 
          m.id === modelMessageId ? { ...m, content: fullText } : m
        ));
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => prev.map(m => 
        m.id === modelMessageId 
          ? { ...m, content: "ይቕሬታ፡ ምስ ሰርቨር ምርኻብ ኣይተኻእለን። በጃኹም ደሓር ደጊምኩም ፈትኑ።" } 
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const startLiveSession = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext({ sampleRate: 16000 });
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice === 'Kore' ? 'Kore' : 'Fenrir' } },
          },
          systemInstruction: SYSTEM_INSTRUCTION + " You are in a LIVE voice conversation mode. Keep responses very short and conversational.",
        },
        callbacks: {
          onopen: () => {
            console.log("Live session opened");
            setIsLiveActive(true);
            
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;
            
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32 to Int16 PCM
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
          },
          onmessage: async (message: any) => {
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcmData = new Int16Array(bytes.buffer);
              audioQueueRef.current.push(pcmData);
              processAudioQueue();
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            console.log("Live session closed");
            stopLiveSession();
          },
          onerror: (error) => {
            console.error("Live session error:", error);
            stopLiveSession();
          }
        }
      });

      liveSessionRef.current = await sessionPromise;
    } catch (error) {
      console.error("Failed to start live session:", error);
      alert("ማይክሮፎን ክንረክብ ኣይከኣልናን። በጃኹም ፍቓድ ሃቡ።");
    }
  };

  const processAudioQueue = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;

    isPlayingRef.current = true;
    const pcmData = audioQueueRef.current.shift()!;
    
    const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 0x7FFF;
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      processAudioQueue();
    };
    source.start();
  };

  const stopLiveSession = () => {
    setIsLiveActive(false);
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const LiveView = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#131314] relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.2, 0.1],
            rotate: [0, 90, 0]
          }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute -top-1/2 -left-1/2 w-full h-full bg-emerald-500/20 blur-[120px] rounded-full"
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            opacity: [0.1, 0.15, 0.1],
            rotate: [0, -90, 0]
          }}
          transition={{ duration: 15, repeat: Infinity }}
          className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-blue-500/20 blur-[120px] rounded-full"
        />
      </div>

      <header className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-20">
        <button onClick={() => { stopLiveSession(); setView('home'); }} className="p-2 text-slate-400 hover:text-white transition-all bg-white/5 rounded-full border border-white/10">
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10">
            <button
              onClick={() => setSelectedVoice('Kore')}
              disabled={isLiveActive}
              className={cn(
                "px-4 py-1.5 rounded-full text-[10px] font-bold transition-all",
                selectedVoice === 'Kore' 
                  ? "bg-emerald-500 text-white shadow-lg" 
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              ጓል (Female)
            </button>
            <button
              onClick={() => setSelectedVoice('Fenrir')}
              disabled={isLiveActive}
              className={cn(
                "px-4 py-1.5 rounded-full text-[10px] font-bold transition-all",
                selectedVoice === 'Fenrir' 
                  ? "bg-emerald-500 text-white shadow-lg" 
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              ወዲ (Male)
            </button>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/10 px-4 py-2 rounded-full border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Live</span>
          </div>
        </div>
      </header>

      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 flex flex-col items-center space-y-12"
      >
        <div className="relative">
          <AnimatePresence>
            {isLiveActive && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1.5, opacity: 0.2 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 bg-emerald-500 rounded-full blur-2xl"
              />
            )}
          </AnimatePresence>
          
          <div className={cn(
            "w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 border-4 shadow-2xl relative z-10",
            isLiveActive 
              ? "bg-emerald-500 border-emerald-400 shadow-emerald-500/40" 
              : "bg-slate-800 border-slate-700 shadow-black/40"
          )}>
            {isLiveActive ? (
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <motion.div
                    key={i}
                    animate={{ height: [20, 60, 20] }}
                    transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                    className="w-1.5 bg-white rounded-full"
                  />
                ))}
              </div>
            ) : (
              <Bot size={80} className="text-slate-500" />
            )}
          </div>
        </div>

        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold text-white">
            {isLiveActive ? "እየሰማዕኩኹም እየ..." : "ክንጅምር ድሉዋት ኢኹም?"}
          </h2>
          <p className="text-slate-400 max-w-xs mx-auto">
            {isLiveActive 
              ? "ብቐጥታ ብድምጺ ክትዛረቡ ትኽእሉ ኢኹም። ኣነ ድማ ብድምጺ ክምልሰልኩም እየ።" 
              : "ነቲ መጠወቒ ብምጥዋቕ ናይ ቀጥታ ድምጺ ዝርርብ ጀምሩ።"}
          </p>
        </div>

        <button
          onClick={isLiveActive ? stopLiveSession : startLiveSession}
          className={cn(
            "px-12 py-5 rounded-2xl font-bold text-lg transition-all shadow-xl flex items-center gap-3",
            isLiveActive 
              ? "bg-red-500 hover:bg-red-600 text-white shadow-red-900/20" 
              : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-900/20"
          )}
        >
          {isLiveActive ? (
            <>
              <VolumeX size={24} />
              <span>ኣቋርጽ (Stop)</span>
            </>
          ) : (
            <>
              <Volume2 size={24} />
              <span>ጀምር (Start Live)</span>
            </>
          )}
        </button>
      </motion.div>

      <div className="absolute bottom-12 left-0 right-0 px-6 text-center">
        <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-bold">
          Powered by Gemini 2.5 Live API
        </p>
      </div>
    </div>
  );

  const downloadAudio = (base64Data: string, filename: string = 'tigrinya-ai-voice.wav') => {
    const audioUrl = pcmToWavUrl(base64Data);
    if (!audioUrl) return;
    
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrivateSend = (image?: string) => {
    if ((!input.trim() && !image) || !socket || !user) return;
    const msg: Message = {
      role: 'user',
      content: input,
      id: Date.now().toString(),
      senderName: user.name,
      image: image
    };
    socket.emit('send-message', { roomId, message: msg });
    setInput('');

    if (aiEnabledInPrivate && !image) {
      handleAISendInPrivate(input);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        handlePrivateSend(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const joinGlobalRoom = () => {
    setRoomId('global_tigrinya_wegi');
    setRoomName('ትግርኛ ወግዒ');
    setView('private-chat');
  };

  const startPrivateChatWithEmail = (targetEmail: string) => {
    if (!user) return;
    // Create a deterministic room ID based on both emails
    const sortedEmails = [user.email, targetEmail].sort();
    const newRoomId = `private_${sortedEmails[0]}_${sortedEmails[1]}`;
    setRoomId(newRoomId);
    setRoomName(`${targetEmail} ምስ ዝግበር ዝርርብ`);
    setView('private-chat');
  };

  const handleAISendInPrivate = async (userText: string) => {
    try {
      const response = await chatInstance.current.sendMessage({ message: userText });
      const aiMsg: Message = {
        role: 'model',
        content: response.text || "ይቕሬታ፡ ጸገም ተፈጢሩ።",
        id: (Date.now() + 1).toString(),
      };
      socket?.emit('send-message', { roomId, message: aiMsg });
    } catch (e) {
      console.error("AI in private chat failed", e);
    }
  };

  const LandingView = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#131314] text-center">
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-md space-y-12"
      >
        <div className="space-y-4">
          <div className="w-24 h-24 rounded-[2rem] bg-emerald-500 mx-auto flex items-center justify-center text-white shadow-2xl shadow-emerald-500/20 relative group">
            <div className="absolute -inset-2 bg-emerald-500 rounded-[2.5rem] blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <Bot size={56} className="relative" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">ትግርኛ AI</h1>
          <p className="text-slate-400 text-lg">ብሉጽን ቅልጡፍን ናይ ትግርኛ ኣርቲፊሻል ኢንተለጀንስ</p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={() => {
              setUser({ id: 'guest', name: 'ጋሻ', email: 'guest@example.com' });
              setView('home');
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-5 rounded-2xl transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-3 group"
          >
            <Play size={20} fill="currentColor" />
            <span>ብቐጥታ ጀምር (Start)</span>
          </button>
          
          <button 
            onClick={() => setView('login')}
            className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-5 rounded-2xl transition-all border border-white/5 flex items-center justify-center gap-3"
          >
            <Mail size={20} />
            <span>ብኢሜል እቶ (Login)</span>
          </button>
        </div>

        <p className="text-slate-500 text-xs pt-8">
          ብምጥቃምኩም ኣብ ውዕልን ደንብን ትሰማምዑ ኣለኹም።
        </p>
      </motion.div>
    </div>
  );

  const LoginView = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      // Mock login
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        // After login, go to onboarding if gender not set, otherwise go to global room
        setView('onboarding');
      }
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#131314]">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="text-center space-y-2 relative">
            <button 
              onClick={() => setView('landing')}
              className="absolute -left-4 top-0 p-2 text-slate-500 hover:text-white transition-all"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="w-20 h-20 rounded-3xl bg-emerald-500 mx-auto flex items-center justify-center text-white shadow-2xl">
              <Bot size={48} />
            </div>
            <h1 className="text-3xl font-bold text-white">ትግርኛ AI</h1>
            <p className="text-slate-400">ናብ መእተዊ ገጽ ተመሊስኩም</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">ኢሜል (Email)</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1e1f20] border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white outline-none focus:border-emerald-500 transition-all"
                  placeholder="ኢሜልኩም ኣእትዉ..."
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">መሕለፊ ቃል (Password)</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#1e1f20] border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white outline-none focus:border-emerald-500 transition-all"
                  placeholder="ምስጢራዊ ቃል..."
                  required
                />
              </div>
            </div>
            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-emerald-900/20">
              እቶ (Sign In)
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-[#131314] px-2 text-slate-500">ወይ ድማ</span></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl border border-white/5 transition-all">
              <Facebook size={18} className="text-blue-500" />
              <span>Facebook</span>
            </button>
            <button className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl border border-white/5 transition-all">
              <div className="w-4 h-4 rounded-full bg-red-500" />
              <span>Google</span>
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const OnboardingView = () => {
    const selectGender = (gender: 'male' | 'female') => {
      if (user) {
        setUser({ ...user, gender });
        // After onboarding, go directly to the global room as requested
        joinGlobalRoom();
      }
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#131314]">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full max-w-md text-center space-y-8"
        >
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-white">ጾታኹም ምረጹ</h2>
            <p className="text-slate-400">ንዓኹም ዝምጥን ድምጺ ንምድላው ይሕግዘኒ</p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <button 
              onClick={() => selectGender('male')}
              className="group p-8 bg-[#1e1f20] hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/50 rounded-3xl transition-all space-y-4"
            >
              <div className="w-20 h-20 rounded-full bg-blue-500/20 mx-auto flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                <User size={40} />
              </div>
              <span className="block text-xl font-bold text-white">ወዲ (Male)</span>
            </button>
            <button 
              onClick={() => selectGender('female')}
              className="group p-8 bg-[#1e1f20] hover:bg-pink-500/10 border border-white/5 hover:border-pink-500/50 rounded-3xl transition-all space-y-4"
            >
              <div className="w-20 h-20 rounded-full bg-pink-500/20 mx-auto flex items-center justify-center text-pink-500 group-hover:scale-110 transition-transform">
                <User size={40} />
              </div>
              <span className="block text-xl font-bold text-white">ጓል (Female)</span>
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const PrivateChatView = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[#131314]">
        <header className="px-6 py-3 flex items-center justify-between bg-[#131314] border-b border-white/5 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button onClick={() => setView('home')} className="p-2 -ml-2 text-slate-400 hover:text-white transition-all">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <Users size={20} className="text-emerald-500" />
              <div className="flex flex-col">
                <span className="text-sm font-bold text-white">{roomName}</span>
                <span className="text-[10px] text-slate-500">{roomUsers.length} ሰባት ኣብ መስመር ኣለዉ</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10">
              <button
                onClick={() => setSelectedVoice('Kore')}
                className={cn(
                  "px-3 py-1 rounded-full text-[9px] font-bold transition-all",
                  selectedVoice === 'Kore' 
                    ? "bg-emerald-500 text-white shadow-lg" 
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                ጓል
              </button>
              <button
                onClick={() => setSelectedVoice('Fenrir')}
                className={cn(
                  "px-3 py-1 rounded-full text-[9px] font-bold transition-all",
                  selectedVoice === 'Fenrir' 
                    ? "bg-emerald-500 text-white shadow-lg" 
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                ወዲ
              </button>
            </div>
            {roomId !== 'global_tigrinya_wegi' && (
              <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
                <Bot size={14} className={aiEnabledInPrivate ? "text-emerald-500" : "text-slate-500"} />
                <button 
                  onClick={() => socket?.emit('toggle-ai', { roomId, enabled: !aiEnabledInPrivate })}
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-widest transition-colors",
                    aiEnabledInPrivate ? "text-emerald-500" : "text-slate-500"
                  )}
                >
                  {aiEnabledInPrivate ? "ሮቦት ኣሎ" : "ሮቦት የለን"}
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
          <AnimatePresence initial={false}>
            {privateMessages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex w-full gap-3",
                  message.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                {message.role === 'model' && (
                  <div className="w-8 h-8 rounded-lg bg-emerald-500 flex flex-col items-center justify-center text-white flex-shrink-0 mt-1 shadow-md border border-emerald-400/30 overflow-hidden">
                    <span className="text-[5px] font-black leading-none mb-0.5 uppercase">ትግርኛ</span>
                    <Bot size={12} />
                  </div>
                )}
                <div className={cn(
                  "flex flex-col gap-1",
                  message.role === 'user' ? "items-end max-w-[80%]" : "items-start max-w-[80%]"
                )}>
                  {roomId === 'global_tigrinya_wegi' && message.senderName && (
                    <span className="text-[10px] text-slate-500 px-2">{message.senderName}</span>
                  )}
                  <div className={cn(
                    "px-4 py-2.5 rounded-2xl text-sm break-words",
                    message.role === 'user' 
                      ? "bg-blue-600 text-white" 
                      : "bg-[#2b2c2d] text-slate-100 border border-white/5"
                  )}>
                    {message.image && (
                      <img src={message.image} alt="Sent image" className="max-w-full rounded-lg mb-2 shadow-lg" referrerPolicy="no-referrer" />
                    )}
                    {message.content}
                  </div>
                  {message.role === 'model' && (
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        disabled={isGeneratingVoice !== null}
                        onClick={async () => {
                          try {
                            setIsGeneratingVoice(message.id);
                            const audio = await generateSpeech(message.content);
                            if (audio) {
                              setPrivateMessages(prev => prev.map(m => m.id === message.id ? { ...m, audio } : m));
                              playAudio(audio, message.id);
                            }
                          } catch (e) {
                            console.error("Voice generation button error", e);
                          } finally {
                            setIsGeneratingVoice(null);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1 rounded-lg transition-all border text-[9px] font-bold uppercase tracking-wider",
                          isGeneratingVoice === message.id
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                            : "bg-white/5 text-slate-500 border-white/10 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {isGeneratingVoice === message.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Volume2 size={12} />
                        )}
                        <span>{isGeneratingVoice === message.id ? "ይዳሎ..." : "ስማዕ"}</span>
                      </button>
                      
                      {message.audio && (
                        <button
                          onClick={() => downloadAudio(message.audio!)}
                          className="p-1.5 bg-white/5 text-slate-500 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition-all"
                          title="Download Voice"
                        >
                          <Download size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </main>

        <footer className="p-4 bg-[#131314]">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleImageUpload}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-3 bg-white/5 hover:bg-white/10 rounded-full text-slate-400 transition-all"
            >
              <Plus size={20} />
            </button>
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePrivateSend()}
                placeholder="ኣብዚ ጸሓፉ..."
                className="w-full bg-[#1e1f20] border border-white/5 rounded-full px-6 py-4 text-slate-100 placeholder:text-slate-500 outline-none pr-28"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  onClick={() => setView('live')}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-emerald-500 hover:bg-white/5 transition-all"
                  title="Live Voice Chat"
                >
                  <Mic size={20} />
                </button>
                <button
                  onClick={() => handlePrivateSend()}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-blue-400 hover:bg-white/5"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    );
  };

  const HomeView = () => {
    const [friendEmail, setFriendEmail] = useState('');

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[#131314]">
        <header className="px-6 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="relative group">
              <div className="absolute -inset-1 bg-emerald-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
              <div className="relative w-10 h-10 rounded-xl bg-emerald-500 flex flex-col items-center justify-center text-white shadow-lg border border-emerald-400/30 overflow-hidden">
                <span className="text-[7px] font-black leading-none mb-0.5 uppercase">ትግርኛ</span>
                <Bot size={18} className="text-white" />
                <span className="text-[6px] font-black leading-none mt-0.5 uppercase tracking-tighter">AI</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-white">Ai ትግርኛ</span>
              {user && <span className="text-[10px] text-slate-500 font-medium">ሰላም {user.name} ({user.gender === 'male' ? 'ወዲ' : 'ጓል'})</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setUser(null);
                setView('login');
              }}
              className="p-2 text-slate-500 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
            <button
              onClick={() => setView('chat')}
              className="p-2 text-slate-400 hover:text-white transition-colors"
            >
              <Plus size={24} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center max-w-3xl mx-auto w-full scrollbar-hide">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-center space-y-4 mb-12"
          >
            <h1 className="text-5xl font-medium tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-emerald-400 to-purple-400">
              ከመይ ክሕግዘኩም እኽእል?
            </h1>
            <p className="text-slate-400 text-lg">ኣነ ትግርኛ AI እየ፡ ንኹሉ ሕቶታትኩም ክምልስ ድሉው እየ።</p>
          </motion.div>

          <div className="w-full space-y-8 mb-12">
            {/* Live Voice Section */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2">ናይ ቀጥታ ድምጺ (Live Mode)</h3>
              <button
                onClick={() => setView('live')}
                className="w-full group p-6 text-left bg-gradient-to-br from-emerald-500/10 to-blue-500/10 hover:from-emerald-500/20 hover:to-blue-500/20 rounded-3xl border border-emerald-500/20 hover:border-emerald-500/50 transition-all flex items-center justify-between relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Volume2 size={80} />
                </div>
                <div className="flex items-center gap-4 relative z-10">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                    <Volume2 size={28} />
                  </div>
                  <div>
                    <h4 className="text-white font-bold text-xl">ቀጥታ ድምጺ (Live Voice)</h4>
                    <p className="text-xs text-slate-400 mt-1">ብድምጺ ጥራይ ዝግበር ቀጥታ ዝርርብ</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/30 relative z-10">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Live</span>
                </div>
              </button>
            </section>

            {/* Global Chat Section */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2">ዓቢ ጉሩብ (Global Group)</h3>
              <button
                onClick={joinGlobalRoom}
                className="w-full group p-6 text-left bg-emerald-600/10 hover:bg-emerald-600/20 rounded-2xl border border-emerald-500/20 hover:border-emerald-500/50 transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg">
                    <Users size={24} />
                  </div>
                  <div>
                    <h4 className="text-emerald-400 font-bold text-lg">ትግርኛ ወግዒ</h4>
                    <p className="text-xs text-emerald-400/60 mt-1">ኩሉ ሰብ ዝሳተፈሉ ናይ ዝርርብ መድረኽ</p>
                  </div>
                </div>
                <ChevronRight className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-all" />
              </button>
            </section>

            {/* Private Chat Section */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2">ብሕታዊ ቻት (Private Chat)</h3>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input 
                    type="email" 
                    value={friendEmail}
                    onChange={(e) => setFriendEmail(e.target.value)}
                    className="w-full bg-[#1e1f20] border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white outline-none focus:border-blue-500 transition-all text-sm"
                    placeholder="ኢሜል ዓርክኹም ኣእትዉ..."
                  />
                </div>
                <button 
                  onClick={() => friendEmail && startPrivateChatWithEmail(friendEmail)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-2xl font-bold transition-all"
                >
                  ኣእቱ
                </button>
              </div>
            </section>

            {/* Suggestions Section */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2">ምኽርታት (Suggestions)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { t: "ከመይ ኣለኻ?", i: "How are you?", icon: <Sparkles size={18} className="text-blue-400" /> },
                  { t: "ዛንታ ንገረኒ", i: "Tell me a story", icon: <Bot size={18} className="text-emerald-400" /> },
                  { t: "ትግርኛ ክመሃር ደልየ", i: "I want to learn Tigrinya", icon: <Languages size={18} className="text-purple-400" /> },
                  { t: "ናይ ሎሚ ዜና", i: "Today's news", icon: <History size={18} className="text-orange-400" /> }
                ].map((suggestion) => (
                  <button
                    key={suggestion.t}
                    onClick={() => {
                      createNewSession();
                      setInput(suggestion.t);
                    }}
                    className="group p-6 text-left bg-[#1e1f20] hover:bg-[#28292a] rounded-2xl border border-transparent hover:border-white/10 transition-all flex flex-col gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      {suggestion.icon}
                    </div>
                    <div>
                      <h4 className="text-slate-200 font-medium">{suggestion.t}</h4>
                      <p className="text-xs text-slate-500 mt-1">{suggestion.i}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="w-full space-y-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <Clock size={16} />
                ዝሓለፉ ዝርርባት
              </h2>
            </div>

            <div className="space-y-2">
              {sessions.length === 0 ? (
                <div className="py-8 text-center text-slate-600 text-sm italic">
                  ዝተቐመጠ ታሪኽ የለን
                </div>
              ) : (
                sessions.slice(0, 5).map((session) => (
                  <div
                    key={session.id}
                    onClick={() => loadSession(session.id)}
                    className="w-full group px-4 py-3 rounded-xl hover:bg-white/5 transition-all flex items-center justify-between text-slate-400 hover:text-white cursor-pointer"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <History size={16} className="flex-shrink-0" />
                      <span className="text-sm truncate">{session.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => deleteSession(e, session.id)}
                        className="p-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                      <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>

        <footer className="p-6 max-w-3xl mx-auto w-full">
          <div 
            onClick={createNewSession}
            className="w-full bg-[#1e1f20] rounded-full px-6 py-4 flex items-center justify-between cursor-pointer border border-white/5 hover:border-white/10 transition-all"
          >
            <span className="text-slate-500">ኣብዚ ጸሓፉ...</span>
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white">
              <Send size={18} />
            </div>
          </div>
        </footer>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen max-w-full mx-auto bg-[#131314] overflow-hidden relative font-sans">
      {view === 'landing' ? (
        <LandingView />
      ) : view === 'login' ? (
        <LoginView />
      ) : view === 'onboarding' ? (
        <OnboardingView />
      ) : view === 'home' ? (
        <HomeView />
      ) : view === 'private-chat' ? (
        <PrivateChatView />
      ) : view === 'live' ? (
        <LiveView />
      ) : (
        <>
          {/* Header */}
          <header className="px-6 py-3 flex items-center justify-between bg-[#131314] border-b border-white/5 sticky top-0 z-20">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setView('home')}
                className="p-2 -ml-2 text-slate-400 hover:text-white transition-all"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-3">
                <div className="relative w-8 h-8 rounded-lg bg-emerald-500 flex flex-col items-center justify-center text-white shadow-md border border-emerald-400/30 overflow-hidden">
                  <span className="text-[6px] font-black leading-none mb-0.5 uppercase">ትግርኛ</span>
                  <Bot size={14} className="text-white" />
                </div>
                <span className="text-sm font-bold text-white">Ai ትግርኛ</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10">
                <button
                  onClick={() => setSelectedVoice('Kore')}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-bold transition-all",
                    selectedVoice === 'Kore' 
                      ? "bg-emerald-500 text-white shadow-lg" 
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  ጓል
                </button>
                <button
                  onClick={() => setSelectedVoice('Fenrir')}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-bold transition-all",
                    selectedVoice === 'Fenrir' 
                      ? "bg-emerald-500 text-white shadow-lg" 
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  ወዲ
                </button>
              </div>
              <button
                onClick={(e) => currentSessionId && deleteSession(e, currentSessionId)}
                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide relative z-10">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-24 h-24 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-2xl shadow-emerald-500/5"
            >
              <Languages size={48} />
            </motion.div>
            <div className="space-y-3 max-w-sm">
              <h2 className="text-3xl font-black text-white tracking-tight">እንቋዕ ብደሓን መጻእኩም!</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                ኣነ ትግርኛ AI እየ። ብንጹር ትግርኛ ክዛረብን ክሕግዘኩምን እኽእል እየ።
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 w-full max-w-sm pt-6">
              {[
                { t: "ከመይ ኣለኻ?", i: "How are you?" },
                { t: "ዛንታ ንገረኒ", i: "Tell me a story" },
                { t: "ትግርኛ ክመሃር ደልየ", i: "I want to learn Tigrinya" }
              ].map((suggestion) => (
                <button
                  key={suggestion.t}
                  onClick={() => setInput(suggestion.t)}
                  className="group px-5 py-4 text-sm text-slate-300 bg-white/5 hover:bg-emerald-500/10 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition-all text-left flex items-center justify-between"
                >
                  <span>{suggestion.t}</span>
                  <span className="text-[10px] text-slate-500 group-hover:text-emerald-400 transition-colors uppercase font-bold tracking-tighter">{suggestion.i}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cn(
                "flex w-full gap-4",
                message.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              {message.role === 'model' && (
                <div className="w-9 h-9 rounded-lg bg-emerald-500 flex flex-col items-center justify-center text-white flex-shrink-0 mt-1 shadow-md border border-emerald-400/30 overflow-hidden">
                  <span className="text-[6px] font-black leading-none mb-0.5 uppercase">ትግርኛ</span>
                  <Bot size={16} />
                </div>
              )}
              <div className="flex flex-col gap-2 max-w-[85%] relative">
                <div
                  className={cn(
                    "px-4 py-3 rounded-2xl transition-all",
                    message.role === 'user'
                      ? "bg-[#2b2c2d] text-slate-100 border border-white/5"
                      : "text-slate-100"
                  )}
                >
                  <div className="markdown-body prose prose-invert prose-sm max-w-none">
                    <Markdown>{message.content}</Markdown>
                  </div>
                </div>

                {message.role === 'model' && message.audio && (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => playAudio(message.audio!, message.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all border text-[10px] font-bold uppercase tracking-wider",
                        isSpeaking === message.id
                          ? "bg-emerald-500 text-white border-emerald-400 animate-pulse"
                          : "bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {isSpeaking === message.id ? (
                        <>
                          <VolumeX size={14} />
                          <span>ጠጠው ኣብል</span>
                        </>
                      ) : (
                        <>
                          <Volume2 size={14} />
                          <span>ስማዕ</span>
                        </>
                      )}
                    </button>
                    <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                      Neural Response
                    </span>
                  </div>
                )}

                {message.role === 'model' && (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      disabled={isGeneratingVoice !== null}
                      onClick={async () => {
                        try {
                          setIsGeneratingVoice(message.id);
                          const audio = await generateSpeech(message.content);
                          if (audio) {
                            setMessages(prev => prev.map(m => m.id === message.id ? { ...m, audio } : m));
                            playAudio(audio, message.id);
                          }
                        } catch (e) {
                          console.error("Voice generation button error", e);
                        } finally {
                          setIsGeneratingVoice(null);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all border text-[10px] font-bold uppercase tracking-wider",
                        isGeneratingVoice === message.id
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-white/5 text-slate-500 border-white/10 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {isGeneratingVoice === message.id ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>ይዳሎ ኣሎ...</span>
                        </>
                      ) : (
                        <>
                          <Volume2 size={14} />
                          <span>ብድምጺ ስማዕ</span>
                        </>
                      )}
                    </button>
                    
                    {message.audio && (
                      <button
                        onClick={() => downloadAudio(message.audio!)}
                        className="p-2 bg-white/5 text-slate-500 border border-white/10 rounded-xl hover:bg-white/10 hover:text-white transition-all"
                        title="Download Voice"
                      >
                        <Download size={14} />
                      </button>
                    )}
                    
                    <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                      Voice Ready
                    </span>
                  </div>
                )}

                {message.role === 'user' && (
                  <span className="text-[9px] font-bold uppercase tracking-widest opacity-30 px-2 text-right">
                    User Identity
                  </span>
                )}
              </div>
              {message.role === 'user' && (
                <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center text-slate-400 flex-shrink-0 mt-1 shadow-lg">
                  <User size={22} />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && messages[messages.length-1]?.content === '' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-4 justify-start"
          >
            <div className="w-9 h-9 rounded-lg bg-emerald-500 flex flex-col items-center justify-center text-white flex-shrink-0 mt-1 shadow-md border border-emerald-400/30 overflow-hidden">
              <span className="text-[6px] font-black leading-none mb-0.5 uppercase">ትግርኛ</span>
              <Bot size={16} />
            </div>
            <div className="bg-[#1e1f20] px-5 py-4 rounded-2xl border border-white/5 flex items-center gap-3">
              <div className="flex gap-1">
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-[#131314] sticky bottom-0 z-20">
        <div className="max-w-3xl mx-auto relative">
          <div className="relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="ኣብዚ ጸሓፉ..."
              className="w-full bg-[#1e1f20] border border-transparent focus:border-white/10 rounded-full px-6 py-4 text-slate-100 placeholder:text-slate-500 transition-all outline-none pr-28 text-base"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={() => setView('live')}
                className="w-10 h-10 rounded-full flex items-center justify-center text-emerald-500 hover:bg-white/5 transition-all"
                title="Live Voice Chat"
              >
                <Mic size={20} />
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                  input.trim() && !isLoading
                    ? "text-blue-400 hover:bg-white/5"
                    : "text-slate-600 cursor-not-allowed"
                )}
              >
                <Send size={20} />
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 text-center mt-3 font-medium">
            ትግርኛ AI ጌጋታት ክሰርሕ ስለ ዝኽእል፡ ኣገዳሲ ሓበሬታ ኣረጋግጹ።
          </p>
        </div>
      </footer>
        </>
      )}
    </div>
  );
}
