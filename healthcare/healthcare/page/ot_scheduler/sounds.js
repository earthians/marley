const DROP_TONES = {
	placed: [
		{ frequency: 660, start: 0, length: 0.09, wave: "sine" },
		{ frequency: 990, start: 0.1, length: 0.14, wave: "sine" },
	],
	refused: [
		{ frequency: 220, start: 0, length: 0.12, wave: "square" },
		{ frequency: 165, start: 0.15, length: 0.18, wave: "square" },
	],
};
const VOLUME = 0.06;

let context = null;

export function playDropSound(name) {
	if (window.frappe?.boot?.user?.mute_sounds) return;
	const AudioContext = window.AudioContext || window.webkitAudioContext;
	if (!AudioContext) return;
	context = context || new AudioContext();
	for (const tone of DROP_TONES[name]) playTone(tone);
}

function playTone({ frequency, start, length, wave }) {
	const at = context.currentTime + start;
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.type = wave;
	oscillator.frequency.value = frequency;
	gain.gain.setValueAtTime(VOLUME, at);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
	oscillator.connect(gain).connect(context.destination);
	oscillator.start(at);
	oscillator.stop(at + length);
}
