# neko audio design specification

Reference: `concept.png`, generated with the built-in Image Gen tool. The complete studio screen is the design reference. The implementation extends it for the subsequently requested offline GPU service, additional formats and six demo files.

- Colors: cool light gray #f6f7f9 page; #ffffff panels; #131b29 text; #7c8699 secondary; #6655ee accent; #e1e5ee borders.
- Container: centered 1264 px desktop workspace, broad audio column and 352 px settings rail; 16 px gutters; single column at 760 px.
- Type: system sans with Microsoft YaHei Chinese fallback. Heading 44 px, section 21 px, controls 13–14 px, captions 11–12 px. No remote font requests.
- Components: thin bordered 12 px panels, 7 px buttons, dashed upload well; original gray waveform and enhanced purple waveform, round play controls.
- Core copy: neko audio; 工作台; GitHub; 让好声音，更进一步。; 把音频拖到这里; 选择音频; 试听示例; 听见每一处变化; 原始音频; 增强音频; 声音调校; 音乐; 人声; AI 降噪; 细节增强; 采样率; 位深; 开始增强; 导出 WAV; 真实增强，诚实呈现。
- Intentional copy additions: GPU reconstruction and setup, inference controls, actual export metadata, loudness match, demo library and offline help, required by expanded product scope. Subtitle uses 细节重建 to describe the actual model path.
- Icons: Lucide, thin rounded outline, 16–30 px; filled playback triangles. Real waveform sample peaks replace the mockup's illustrative waveform.
- Responsive: single column upload, A/B comparison, settings, demos. Both players remain available. No horizontal scrolling.
- Motion: hover color feedback and scroll-to-demo; respect reduced-motion setting.

Concept brief: complete Chinese audio studio with upload, stacked A/B waveforms, right settings rail and honest output-quality explanation; light gray/white/periwinkle palette, no marketing imagery or fake metrics. Generated using the built-in image tool, not an external API.
