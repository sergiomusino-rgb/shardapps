import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from 'next/server';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { prompt, lang } = body;
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const systemInstruction = `Sei l'architetto di ShardApps. Genera SOLO un oggetto JSON valido basato su questo prompt: "${prompt}".
    Lingua: ${lang}. 
    Schema obbligatorio (NON aggiungere altro testo):
    { 
      "appName": "string", 
      "schema": { "fields": [{ "id": "string", "type": "string", "label": "string" }] } 
    }`;

    const result = await model.generateContent(systemInstruction);
    const text = result.response.text();
    
    // PULIZIA: Rimuove eventuali blocchi markdown ```json e ```
    const cleanedText = text.replace(/```json\s*|\s*```/g, '').trim();
    
    return NextResponse.json(JSON.parse(cleanedText));
  } catch (error) {
    console.error('Error generating app schema:', error);
    return NextResponse.json({ error: 'Failed to generate schema' }, { status: 500 });
  }
}