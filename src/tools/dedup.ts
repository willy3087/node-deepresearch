import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY, modelConfigs, USE_LOCAL_MODEL, LOCAL_MODEL_ENDPOINT } from "../config";
import { TokenTracker } from "../utils/token-tracker";
import { LocalModelClient } from "./local-model-client";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 segundo

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryWithRetry(fn: () => Promise<any>, retries = MAX_RETRIES): Promise<any> {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      console.log(`Tentativa falhou, tentando novamente em ${RETRY_DELAY}ms... (${retries} tentativas restantes)`);
      await sleep(RETRY_DELAY);
      return tryWithRetry(fn, retries - 1);
    }
    throw error;
  }
}

export async function dedupQueries(queries: string[], existingQueries: string[], tracker?: TokenTracker): Promise<{ unique_queries: string[], tokens: number }> {
  if (!queries || queries.length === 0) {
    return { unique_queries: [], tokens: 0 };
  }

  const prompt = `Compare as seguintes queries e retorne apenas as que são semanticamente diferentes das queries existentes.

Queries para analisar:
${queries.join('\n')}

Queries existentes:
${existingQueries.join('\n')}

Retorne apenas as queries que são semanticamente diferentes em formato JSON:
{
  "unique_queries": ["query1", "query2"]
}`;

  async function tryLocalModel() {
    const localModel = new LocalModelClient(LOCAL_MODEL_ENDPOINT);
    const model = localModel.getGenerativeModel({
      model: "qwen2.5-7b-instruct-1m",
      generationConfig: {
        temperature: modelConfigs.dedup.temperature
      }
    });

    const result = await tryWithRetry(async () => {
      const response = await model.generateContent(prompt);
      return response;
    });

    const response = result.response;
    const content = JSON.parse(response.text());

    if (!content.unique_queries || !Array.isArray(content.unique_queries)) {
      throw new Error('Formato de resposta inválido do modelo local');
    }

    (tracker || new TokenTracker()).trackUsage('dedup', response.usageMetadata?.totalTokenCount || 0);
    return {
      unique_queries: content.unique_queries,
      tokens: response.usageMetadata?.totalTokenCount || 0
    };
  }

  async function tryGemini() {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: modelConfigs.dedup.model,
      generationConfig: {
        temperature: modelConfigs.dedup.temperature
      }
    });

    const result = await tryWithRetry(async () => {
      const response = await model.generateContent(prompt);
      return response;
    });

    const response = await result.response;
    const usage = response.usageMetadata;
    const content = JSON.parse(response.text());

    if (!content.unique_queries || !Array.isArray(content.unique_queries)) {
      throw new Error('Formato de resposta inválido do Gemini');
    }

    (tracker || new TokenTracker()).trackUsage('dedup', usage?.totalTokenCount || 0);
    return {
      unique_queries: content.unique_queries,
      tokens: usage?.totalTokenCount || 0
    };
  }

  try {
    // Se USE_LOCAL_MODEL for true, tenta primeiro o modelo local
    if (USE_LOCAL_MODEL) {
      try {
        return await tryLocalModel();
      } catch (error) {
        console.error('Erro ao usar modelo local, tentando Gemini como fallback:', error);
        // Se falhar e tivermos a chave do Gemini, tenta como fallback
        if (GEMINI_API_KEY) {
          return await tryGemini();
        }
        throw error;
      }
    } 
    // Se não for local, tenta Gemini primeiro e modelo local como fallback
    else {
      try {
        return await tryGemini();
      } catch (error) {
        console.error('Erro ao usar Gemini, tentando modelo local como fallback:', error);
        return await tryLocalModel();
      }
    }
  } catch (error) {
    console.error('Erro na deduplicação:', error);
    // Em último caso, retorna as queries originais
    return {
      unique_queries: queries,
      tokens: 0
    };
  }
}

export async function main() {
  const newQueries = process.argv[2] ? JSON.parse(process.argv[2]) : [];
  const existingQueries = process.argv[3] ? JSON.parse(process.argv[3]) : [];

  try {
    await dedupQueries(newQueries, existingQueries);
  } catch (error) {
    console.error('Failed to deduplicate queries:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
