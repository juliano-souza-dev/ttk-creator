import { AudioLines, Film, Plus, Play, Pause, Trash2, Scissors, Copy, SkipBack, SkipForward, Volume2, VolumeX, Music2, Type, WandSparkles, MousePointer2, ChevronLeft, ChevronRight, Download, LoaderCircle, PanelsTopLeft, FileJson, Upload, Eye, Camera, BookOpen, Headphones, Lightbulb, Clock3, MessageCircle, CheckCircle2, Globe2, Heart, Star, Zap, Target, Search, Image, Music, Mic, Video, PlayCircle, AlertCircle, ArrowRight, CircleHelp, Sparkles, Trophy, Rocket, Smile, ThumbsUp, Bookmark, MapPin, Coffee, Sun, Moon, Cloud, Flame, ShieldCheck, Languages, GraduationCap, Pencil, Bell, CalendarDays, RotateCcw, Maximize, Minimize, Captions, Clapperboard, MicOff, Presentation, Monitor, Smartphone, Home, Menu, X, XCircle, Check, Award, Medal, Flag, Info, AlertTriangle, Timer, Brain, Puzzle, Calculator, Hash, BarChart3, PieChart, Palette, Shapes, Share2, Settings, User, Users, Minus, Layers, List, Map as MapIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

export const lucideIconLibrary = {
  // Nomes legados preservados para não quebrar projetos já salvos.
  Eye, Camera, BookOpen, Headphones, Lightbulb, Clock3, MessageCircle, CheckCircle2,
  Globe2, Heart, Star, Zap, Target, Image, Music, Mic, Video, PlayCircle, AlertCircle,
  ArrowRight, CircleHelp, Sparkles, Trophy, Rocket, Smile, ThumbsUp, Bookmark, MapPin,
  Coffee, Sun, Moon, Cloud, Flame, ShieldCheck, Languages, GraduationCap, Pencil, Bell,
  CalendarDays,
  // Biblioteca ampliada: nomes em kebab-case para busca e compatibilidade com Scene Spec.
  "play": Play, "pause": Pause, "skip-back": SkipBack, "skip-forward": SkipForward,
  "rotate-ccw": RotateCcw, "volume-2": Volume2, "volume-x": VolumeX,
  "maximize": Maximize, "minimize": Minimize, "captions": Captions, "video": Video,
  "film": Film, "clapperboard": Clapperboard, "mic": Mic, "mic-off": MicOff,
  "camera": Camera, "headphones": Headphones, "music": Music,
  "book-open": BookOpen, "graduation-cap": GraduationCap, "layers": Layers, "list": List,
  "chevron-right": ChevronRight, "arrow-right": ArrowRight, "presentation": Presentation,
  "monitor": Monitor, "smartphone": Smartphone, "home": Home, "menu": Menu, "x": X,
  "circle-check": CheckCircle2, "circle-x": XCircle, "check": Check, "star": Star,
  "trophy": Trophy, "award": Award, "medal": Medal, "flag": Flag, "lightbulb": Lightbulb,
  "circle-question-mark": CircleHelp, "info": Info, "triangle-alert": AlertTriangle,
  "timer": Timer, "clock": Clock3, "brain": Brain, "target": Target, "puzzle": Puzzle,
  "rocket": Rocket, "sparkles": Sparkles, "calculator": Calculator, "hash": Hash,
  "chart-column": BarChart3, "chart-pie": PieChart, "pencil": Pencil, "type": Type,
  "languages": Languages, "globe": Globe2, "map": MapIcon, "image": Image,
  "palette": Palette, "shapes": Shapes, "heart": Heart, "download": Download,
  "upload": Upload, "share-2": Share2, "settings": Settings, "user": User, "users": Users,
  "eye": Eye, "search": Search, "plus": Plus, "minus": Minus,
};

export type LucideIconName = keyof typeof lucideIconLibrary;
export const lucideIconNames = Object.keys(lucideIconLibrary) as LucideIconName[];
export const supportedLucideIconNames: string[] = lucideIconNames;



export async function renderLucideIconPng(name: LucideIconName, color: string, size: number): Promise<string> {
  const IconView = lucideIconLibrary[name];
  const svg = renderToStaticMarkup(<IconView xmlns="http://www.w3.org/2000/svg" width={size} height={size} color={color || "#ffffff"} strokeWidth={2.2} />);
  const image = new window.Image();
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Não foi possível rasterizar o ícone " + name + ".")); image.src = source; });
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem do ícone.");
    context.drawImage(image, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } finally { URL.revokeObjectURL(source); }
}
