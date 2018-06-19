export const buildKeyMap = function(list: any, min: number) {
  console.log('Building KeySymbol to KeyCode Map.');
  const ks2kc = [];
  for (var k in list) {
    for (var m in list[k]) {
      if (list[k][m] !== 0) ks2kc[list[k][m]] = parseInt(k) + min;
    }
  }
  return ks2kc;
};

export const translateModifiers = function(sModifier: string) {
  switch (sModifier) {
    case 'shift':
      return 1;
    case 'capslock':
      return 2;
    case 'control':
      return 4;
    case 'alt':
      return 8;
    case 'numlock':
      return 16;
    case 'super':
      return 64;
    case 'scrollock':
      return 128;
    default:
      throw new Error(`Unknown keycode ${sModifier}`);
  }
};
