export function microphoneButtonContent(recording=false){
 return `<svg class="record-microphone" viewBox="0 0 48 64" aria-hidden="true" focusable="false"><rect x="15" y="3" width="18" height="35" rx="9" fill="currentColor"/><path d="M9 29v3a15 15 0 0 0 30 0v-3M24 47v12M14 59h20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><span>${recording?'녹음 중…':'녹음 시작'}</span>`;
}
