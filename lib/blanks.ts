/** Text the owner still has to fill in, like "[time to call]". Shared with the reply box, so no server imports here. */
export const BLANK = /\[[^\]\n]{1,80}\]/;
export const hasBlanks = (text: string) => BLANK.test(text);
