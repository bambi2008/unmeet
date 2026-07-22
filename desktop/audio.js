// UnMeet Desktop — Audio Capture & Transcription Engine
const { desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'UnMeet');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

class AudioEngine {
  constructor() {
    if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
    this.recording = false;
    this.mediaRecorder = null;
    this.chunks = [];
    this.currentMeetingId = null;
    this.currentFilePath = null;
    this.autoTranscribe = true;
  }

  async startRecording(meetingId) {
    if (this.recording) return false;
    this.recording = true;
    this.currentMeetingId = meetingId;
    this.chunks = [];

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0]?.id || '',
          },
        },
        video: false,
      });

      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      this.mediaRecorder.onstop = () => { this._save(); stream.getTracks().forEach(t => t.stop()); };
      this.mediaRecorder.start(10000);
      console.log('[Audio] Recording started:', meetingId);
      return true;
    } catch (e) {
      console.error('[Audio] Start failed:', e.message);
      this.recording = false;
      return false;
    }
  }

  stopRecording() {
    if (!this.recording || !this.mediaRecorder) return;
    this.mediaRecorder.stop();
    this.recording = false;
    console.log('[Audio] Stopped:', this.currentMeetingId);
  }

  _save() {
    if (this.chunks.length === 0) return;
    const allData = Buffer.concat(this.chunks.map(c => Buffer.from(c.arrayBuffer ? c.arrayBuffer() : [])));
    const filePath = path.join(AUDIO_DIR, `${this.currentMeetingId}.webm`);
    fs.writeFileSync(filePath, allData);
    this.currentFilePath = filePath;
    console.log('[Audio] Saved:', filePath, `(${allData.length} bytes)`);
  }

  async transcribe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      const audioData = fs.readFileSync(filePath);
      const base64 = audioData.toString('base64');
      const key = process.env.DEEPSEEK_API_KEY || '';
      const resp = await fetch('https://api.deepseek.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', file: base64, language: 'auto', response_format: 'verbose_json' }),
      });
      const result = await resp.json();
      return { text: result.text || '', segments: result.segments || [], language: result.language || 'unknown', duration: result.duration || 0 };
    } catch (e) { console.error('[Transcribe] Error:', e.message); return null; }
  }

  async callDeepSeek(prompt) {
    try {
      const key = process.env.DEEPSEEK_API_KEY || '';
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1000 }),
      });
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const m = content.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : { raw: content };
    } catch (e) { console.error('[DeepSeek] Error:', e.message); return null; }
  }

  async generateSummary(transcript, meetingTitle = '') {
    if (!transcript || transcript.length < 20) return null;
    const prompt = `Analyze this meeting transcript. Return JSON only with these fields: summary (2-3 sentences), decisions (array of strings), actionItems (array of {task, assignee, deadline}), topics (array), effectivenessScore (1-10), wastedTimePct (0-100), offTopicMinutes (number), shouldHaveBeenEmail (true/false).\n\nMeeting: ${meetingTitle || 'Unknown'}\nTranscript: ${transcript.slice(0, 8000)}`;
    return this.callDeepSeek(prompt);
  }

  async analyzeParticipation(transcript) {
    if (!transcript || transcript.length < 50) return null;
    const prompt = `Analyze this meeting transcript for participation. Return JSON: {totalSpeakers (number), speakers ([{label, talkTimePct (0-100), sentiment, interruptionCount, keyContributions}]), dominatedByFew (true/false), silentParticipants ([string]), crossTalkInstances (number), meetingFlow (structured/chaotic/balanced)}.\n\nTranscript: ${transcript.slice(0, 6000)}`;
    return this.callDeepSeek(prompt);
  }

  async runFullPipeline(meetingId, meetingTitle = '') {
    const fp = this.currentFilePath || path.join(AUDIO_DIR, `${meetingId}.webm`);
    if (!fs.existsSync(fp)) return null;
    console.log('[Pipeline] Starting...');
    const transcript = await this.transcribe(fp);
    if (!transcript) return { error: 'Transcription failed' };
    const [summary, participation] = await Promise.all([
      this.generateSummary(transcript.text, meetingTitle),
      this.analyzeParticipation(transcript.text),
    ]);
    const result = { meetingId, transcript: transcript.text.slice(0, 5000), summary: summary?.summary || '', decisions: summary?.decisions || [], actionItems: summary?.actionItems || [], topics: summary?.topics || [], effectivenessScore: summary?.effectivenessScore || null, wastedTimePct: summary?.wastedTimePct || null, offTopicMinutes: summary?.offTopicMinutes || null, shouldHaveBeenEmail: summary?.shouldHaveBeenEmail || false, participation };
    const ap = path.join(DATA_DIR, `analysis-${meetingId}.json`);
    fs.writeFileSync(ap, JSON.stringify(result, null, 2));
    return result;
  }
}

module.exports = { AudioEngine };
