/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Send, Bot, User, Sparkles, Loader2, Trash2, Languages } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  role: 'user' | 'model';
  content: string;
  id: string;
}

const SYSTEM_INSTRUCTION = `You are "ትግርኛ AI" (Tigrinya AI), a helpful and friendly assistant. 
Your primary language is Tigrinya (ትግርኛ). 
You should respond in Tigrinya by default, using the Ge'ez script. 
If a user speaks to you in English or another language, you can respond in that language but try to offer a Tigrinya translation if relevant. 
Be culturally respectful and knowledgeable about Eritrean and Ethiopian culture where Tigrinya is spoken.
Keep your responses concise and clear.`;

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInstance = useRef<any>(null);

  // Initialize Gemini Chat
  useEffect(() => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    chatInstance.current = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      id: Date.now().toString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await chatInstance.current.sendMessage({ message: input });
      const modelMessage: Message = {
        role: 'model',
        content: response.text || "ይቕሬታ፡ ጸገም ተፈጢሩ።", // "Sorry, an error occurred" in Tigrinya
        id: (Date.now() + 1).toString(),
      };
      setMessages(prev => [...prev, modelMessage]);
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        role: 'model',
        content: "ይቕሬታ፡ ምስ ሰርቨር ምርኻብ ኣይተኻእለን። በጃኹም ደሓር ደጊምኩም ፈትኑ።", // "Sorry, could not connect to server. Please try again later."
        id: (Date.now() + 1).toString(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    // Re-initialize chat to clear history on the model side too
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    chatInstance.current = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-white shadow-2xl overflow-hidden md:my-4 md:h-[calc(100vh-2rem)] md:rounded-2xl">
      {/* Header */}
      <header className="px-6 py-4 border-bottom border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <Languages size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">ትግርኛ AI</h1>
            <p className="text-xs text-slate-500 font-medium flex items-center gap-1">
              <Sparkles size={12} className="text-emerald-500" />
              ብ Gemini ዝተሓገዘ
            </p>
          </div>
        </div>
        <button 
          onClick={clearChat}
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Clear Chat"
        >
          <Trash2 size={20} />
        </button>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-60">
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-400">
              <Bot size={32} />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-slate-800">እንቋዕ ብደሓን መጻእኩም!</h2>
              <p className="max-w-xs text-sm text-slate-500">
                ኣነ ትግርኛ AI እየ። ብትግርኛ ክሕግዘኩም እኽእል እየ። ሕቶ ኣለኩም?
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm pt-4">
              {["ከመይ ኣለኻ?", "ትግርኛ ክመሃር ደልየ", "ጽቡቕ ግጥሚ ጸሓፈለይ"].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-4 py-2 text-sm text-slate-600 bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 rounded-xl border border-slate-100 transition-all text-left"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cn(
                "flex w-full gap-3",
                message.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              {message.role === 'model' && (
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0 mt-1">
                  <Bot size={18} />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] px-4 py-3 rounded-2xl shadow-sm",
                  message.role === 'user'
                    ? "bg-emerald-600 text-white rounded-tr-none"
                    : "bg-slate-100 text-slate-800 rounded-tl-none"
                )}
              >
                <div className="markdown-body">
                  <Markdown>{message.content}</Markdown>
                </div>
              </div>
              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-slate-600 flex-shrink-0 mt-1">
                  <User size={18} />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3 justify-start"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
              <Bot size={18} />
            </div>
            <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-emerald-600" />
              <span className="text-sm text-slate-500 font-medium">ይጽሕፍ ኣሎ...</span>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-6 bg-white border-t border-slate-100">
        <div className="relative flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="ኣብዚ ጸሓፉ..."
            className="flex-1 bg-slate-50 border-none rounded-2xl px-5 py-4 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500 transition-all outline-none pr-14"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={cn(
              "absolute right-2 p-3 rounded-xl transition-all",
              input.trim() && !isLoading
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            )}
          >
            <Send size={20} />
          </button>
        </div>
        <p className="text-[10px] text-center text-slate-400 mt-4 uppercase tracking-widest font-bold">
          ትግርኛ AI • Powered by Google Gemini
        </p>
      </footer>
    </div>
  );
}
