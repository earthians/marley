// Short tones for a drop on the OT Scheduler, made in the browser so they sound
// unlike desk's submit and error sounds. Silent when the user has muted desk sounds.

const DROP_TONES = {
	// two notes rising: the case is placed
	placed: [
		{ frequency: 660, start: 0, length: 0.09, wave: "sine" },
		{ frequency: 990, start: 0.1, length: 0.14, wave: "sine" },
	],
	// two low notes falling: the drop was refused
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
