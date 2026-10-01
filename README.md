> ### 🔌 New: AutoMix as a Claude plugin
> The mixing & mastering engine now also lives in [`plugin/`](plugin/README.md) as a standalone, headless
> Claude plugin (MCP server + skills + slash commands) — real offline DSP with BS.1770 loudness metering,
> true-peak limiting, linear-phase EQ, noise reduction and vocal+beat mixing. Install with
> `/plugin marketplace add gajanansr/audioengine` then `/plugin install automix@automix`.

<p align="center">
  <h1 align="center">🎙️ AutoMix</h1>
  <p align="center">
    <strong>AI-Powered Audio Engine for Studio-Quality Vocals</strong>
  </p>
  <p align="center">
    Transform phone-recorded vocals into professional, studio-quality songs — no mixing or mastering knowledge required.
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#what-makes-automix-different">What's Different</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## 🚀 What is AutoMix?

AutoMix is a **web-based AI audio engine** designed specifically for **beginners** who want to create professional-sounding music without years of audio engineering experience. Upload your phone-recorded vocals, and our AI handles everything — from noise reduction to pitch correction to professional mastering.

---

## ✨ What Makes AutoMix Different?

### Vs. Traditional DAWs (Logic, Ableton, FL Studio)

| Feature | Traditional DAWs | AutoMix |
|---------|------------------|---------|
| Learning Curve | Months to years | Minutes |
| Plugin Knowledge | 50+ plugins to master | Zero plugins to learn |
| Mixing Expertise | Required | AI handles it |
| Price | $200-$600+ | Free/Affordable |
| Platform | Desktop only | Web-based, any device |

### Vs. Auto-Tune Apps (Voloco, StarMaker)

| Feature | Auto-Tune Apps | AutoMix |
|---------|----------------|---------|
| Processing | Pitch only | Full vocal chain |
| Quality | Basic | Studio-grade |
| Intelligence | Rule-based | AI-adaptive |
| Output | Processed vocals | Complete mixed song |

### 🎯 Key Differentiators

1. **🧠 AI-Powered Smart Mixing**  
   Unlike simple auto-tune apps, AutoMix analyzes your vocal characteristics and automatically applies a complete professional mixing chain — EQ, compression, de-essing, reverb, and more — optimized for YOUR voice.

2. **📱 Phone Recording Specialist**  
   Built specifically to rescue phone recordings. Our AI detects and fixes common phone recording issues: room noise, harsh frequencies, inconsistent levels, and more.

3. **🎚️ Simplified Macro Controls**  
   Instead of 100+ confusing parameters, users get just 4 intuitive sliders:
   - **AutoTune Strength** — Natural to T-Pain
   - **Reverb Amount** — Dry to ambient
   - **Polish Level** — Raw to studio sheen
   - **Vocal Loudness** — Quiet to punchy

4. **🔬 Reference Track Matching**  
   Upload a reference song you love, and AutoMix will analyze its vocal tone and match your mix to that professional sound.

5. **⚡ Real-Time Preview + Cloud Render**  
   Hear changes instantly in your browser, then render final high-quality audio in the cloud with zero compression.

---

## 🔧 Features

### Core Audio Processing

- ✅ **Intelligent Gain Staging** — Auto-normalize to optimal levels
- ✅ **Noise Reduction** — Neural network-powered (RNNoise)
- ✅ **Dynamic EQ** — Subtractive (mud/harshness removal) and additive (presence/air)
- ✅ **Multi-stage Compression** — Leveling + Control compression
- ✅ **Professional De-Esser** — Dynamic sibilance control
- ✅ **AutoTune** — Key-aware pitch correction with humanization
- ✅ **Saturation** — Tube harmonics for warmth
- ✅ **Reverb & Delay** — Space and dimension
- ✅ **Mastering Chain** — Multiband compression + true-peak limiting

### AI Features

- 🎵 Automatic key and scale detection
- 👤 Gender-aware processing (different EQ curves)
- 🎤 Phone recording quality detection
- 📊 Reference track tonal matching
- 🎛️ Smart parameter optimization

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                    CLIENT (PWA)                         │
│  React Frontend + Web Audio API + AudioWorklet         │
├────────────────────────────────────────────────────────┤
│                         ↓                               │
├────────────────────────────────────────────────────────┤
│                    BACKEND API                          │
│  Supabase (Auth + DB + Storage + Edge Functions)       │
├────────────────────────────────────────────────────────┤
│                         ↓                               │
├────────────────────────────────────────────────────────┤
│              WORKER (Cloud Render)                      │
│  Docker container for offline high-quality rendering   │
└────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 18, TypeScript, Vite |
| **Audio Engine** | Web Audio API, AudioWorklet |
| **Backend** | Supabase (Postgres, Auth, Storage, Edge Functions) |
| **Workers** | Docker, Node.js |
| **Pitch Detection** | Essentia.js / Custom algorithms |
| **Noise Reduction** | RNNoise (WASM) |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account (free tier works)

### Installation

```bash
# Clone the repository
git clone https://github.com/gajanansr/audioEngine.git
cd audioEngine

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Fill in your Supabase credentials in .env

# Build the audio engine
npm run build

# Start the web app
cd web
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

### Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Worker (optional, for cloud rendering)
POLL_INTERVAL_MS=5000
WORKER_ID=worker-1
```

---

## 📁 Project Structure

```
audioEngine/
├── src/                    # Core audio engine (TypeScript)
│   ├── core/               # Audio graph management
│   ├── plugins/            # DSP plugins (EQ, Compressor, etc.)
│   │   ├── dynamics/       # Compressor, Limiter, De-Esser
│   │   ├── eq/             # Parametric EQ
│   │   ├── effects/        # Reverb, Delay, Saturation
│   │   └── pitch/          # AutoTune, Pitch Detection
│   ├── ai/                 # AI analyzers & optimizers
│   ├── chains/             # Vocal chain configurations
│   └── macros/             # User-facing macro controls
├── web/                    # React frontend
│   └── src/
│       ├── components/     # UI components
│       ├── pages/          # Route pages
│       └── hooks/          # Custom React hooks
├── worker/                 # Cloud rendering worker
├── supabase/               # Database schema & types
└── docs/                   # Documentation
```

---

## 🤝 Contributing

We welcome contributions from developers of all skill levels! Here's how you can help:

### Ways to Contribute

| Type | Description |
|------|-------------|
| 🐛 **Bug Reports** | Found a bug? Open an issue with steps to reproduce |
| 💡 **Feature Requests** | Have an idea? Open a discussion or issue |
| 📝 **Documentation** | Improve README, add examples, write tutorials |
| 🔧 **Code** | Pick an issue and submit a PR |
| 🧪 **Testing** | Write tests, find edge cases |
| 🎨 **Design** | UI/UX improvements |

### Development Setup

1. **Fork the repository**

2. **Clone your fork**

   ```bash
   git clone https://github.com/YOUR_USERNAME/audioEngine.git
   cd audioEngine
   ```

3. **Create a branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Install dependencies**

   ```bash
   npm install
   cd web && npm install
   ```

5. **Make your changes**
   - Follow the existing code style
   - Add tests for new features
   - Update documentation as needed

6. **Run tests**

   ```bash
   npm run test
   npm run lint
   ```

7. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `refactor:` Code refactoring
   - `test:` Adding tests
   - `chore:` Maintenance

8. **Push and create PR**

   ```bash
   git push origin feature/your-feature-name
   ```

   Then open a Pull Request on GitHub.

### Good First Issues

Look for issues labeled `good first issue` — these are great for newcomers:

- 📚 Documentation improvements
- 🧪 Adding unit tests
- 🎨 UI polish
- 🐛 Small bug fixes

### Code Style

- **TypeScript** for all code
- **ESLint** for linting
- **Prettier** for formatting (coming soon)
- Meaningful variable/function names
- Comments for complex DSP algorithms

### Plugin Development

Want to add a new audio plugin? Here's the interface to implement:

```typescript
interface AudioPlugin {
  id: string;
  name: string;
  type: 'insert' | 'send';
  bypass: boolean;
  
  process(input: Float32Array, output: Float32Array): void;
  setParameter(name: string, value: number): void;
  getParameter(name: string): number;
  getParameterDescriptors(): ParameterDescriptor[];
}
```

See `src/plugins/base/BasePlugin.ts` for the base class, and check existing plugins for examples.

---

## 🗺️ Roadmap

- [x] Core audio graph manager
- [x] Basic plugins (EQ, Compressor, Limiter)
- [x] AutoTune module
- [x] AI parameter optimizer
- [x] Macro control system
- [ ] WASM pitch correction (higher quality)
- [ ] RNNoise integration
- [ ] Reference track matching
- [ ] Cloud rendering pipeline
- [ ] Mobile-optimized UI
- [ ] Preset system

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [RNNoise](https://jmvalin.ca/demo/rnnoise/) — Neural network noise suppression
- [Essentia.js](https://mtg.github.io/essentia.js/) — Audio analysis library
- [Supabase](https://supabase.com/) — Backend infrastructure

---

## 📬 Contact

Have questions? Open an issue or reach out!

---

<p align="center">
  Made with ❤️ for musicians who just want to sound good
</p>
