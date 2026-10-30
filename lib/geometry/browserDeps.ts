import { getFont } from './fonts';
import { convertImage } from './imageConvert';
import type { ModelDeps } from './model';

/** Dependencies for building models in the browser (fonts via fetch, canvas-based decoding). */
export const browserDeps: ModelDeps = {
  getFont,
  convertImage: (image, settings) => convertImage(image, settings),
};
