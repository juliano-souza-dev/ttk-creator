import { useState } from "react";
import { desktopApi, isDesktopRuntime } from "../../services/desktop-api";
import type { GroqSettings } from "../../services/desktop-api";

export function useGroqSettings() {
  const [groqSettingsOpen, setGroqSettingsOpen] = useState(false);
  const [groqSettings, setGroqSettings] = useState<GroqSettings | null>(null);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqModel, setGroqModel] = useState("llama-3.3-70b-versatile");
  const [groqMaxChars, setGroqMaxChars] = useState(7000);
  const [groqMaxCues, setGroqMaxCues] = useState(25);
  const [groqDelay, setGroqDelay] = useState(1800);
  const [groqLanguage, setGroqLanguage] = useState("Português brasileiro");
  const [groqSettingsBusy, setGroqSettingsBusy] = useState(false);
  const [groqSettingsMessage, setGroqSettingsMessage] = useState("");

  async function openGroqSettings() {
    setGroqSettingsOpen(true);
    setGroqSettingsMessage("");
    if (!isDesktopRuntime) return;
    try {
      const settings = await desktopApi.getGroqSettings();
      setGroqSettings(settings);
      setGroqModel(settings.model);
      setGroqMaxChars(settings.maxChunkChars);
      setGroqMaxCues(settings.maxCuesPerChunk);
      setGroqDelay(settings.delayMs);
      setGroqLanguage(settings.targetLanguage);
    } catch (error) {
      setGroqSettingsMessage("Não foi possível carregar as configurações: " + String(error));
    }
  }

  async function saveAndTestGroq() {
    if (!groqApiKey.trim() && !groqSettings?.configured) {
      setGroqSettingsMessage("Informe sua chave Groq para salvar. Por segurança, ela nunca será exibida novamente.");
      return;
    }
    setGroqSettingsBusy(true);
    setGroqSettingsMessage("");
    try {
      const saved = await desktopApi.saveGroqSettings({
        apiKey: groqApiKey,
        model: groqModel,
        maxChunkChars: groqMaxChars,
        maxCuesPerChunk: groqMaxCues,
        delayMs: groqDelay,
        targetLanguage: groqLanguage
      });
      setGroqSettings(saved);
      setGroqApiKey("");
      setGroqSettingsMessage("Configurações salvas. Testando a conexão com a Groq...");
      const result = await desktopApi.testGroqConnection(groqModel);
      setGroqSettingsMessage("Chave salva com segurança. " + result);
    } catch (error) {
      setGroqSettingsMessage("Falha ao salvar ou testar a Groq: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setGroqSettingsBusy(false);
    }
  }

  return {
    groqSettingsOpen, setGroqSettingsOpen,
    groqSettings, groqApiKey, setGroqApiKey,
    groqModel, setGroqModel,
    groqMaxChars, setGroqMaxChars,
    groqMaxCues, setGroqMaxCues,
    groqDelay, setGroqDelay,
    groqLanguage, setGroqLanguage,
    groqSettingsBusy, groqSettingsMessage,
    openGroqSettings, saveAndTestGroq
  };
}
