// imageResize.js — 头像的居中裁切与压缩。
//
// 裁切几何单独抽成纯函数：它是这里唯一会算错的部分（裁哪一段、缩多少），
// 而 canvas 那几行只是把结果画出来，没什么可断言的。

export const AVATAR_SIZE = 256;          // 存储边长（2× 于 UI 的 96px，够视网膜屏用）
export const AVATAR_JPEG_QUALITY = 0.85;
export const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_AVATAR_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * 从任意尺寸的图里取出居中的最大正方形。
 * 返回值直接对应 canvas drawImage 的源矩形。
 */
export function centerSquare(width, height) {
  const side = Math.min(width, height);
  return {
    sx: Math.max(0, Math.round((width - side) / 2)),
    sy: Math.max(0, Math.round((height - side) / 2)),
    side,
  };
}

/** 选图后的本地校验，错误文案直接给用户看。 */
export function validateAvatarFile(file) {
  if (!file) return '请选择一张图片';
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) return '仅支持 JPEG / PNG / WebP';
  if (file.size > MAX_AVATAR_INPUT_BYTES) return '图片体积过大，上限 10MB';
  return '';
}

/**
 * 居中裁成正方形并压到 AVATAR_SIZE 的 JPEG。
 *
 * 压缩放在浏览器端：上传体积从几 MB 降到 20KB 上下，手机弱网下这一步比任何
 * 服务端优化都管用；后端也因此只需接受统一格式，校验面更小。
 */
export async function compressAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const { sx, sy, side } = centerSquare(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  // 先铺白：PNG/WebP 的透明区域转成 JPEG 后会变黑。
  context.fillStyle = '#fff';
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('图片处理失败，请换一张试试'))),
      'image/jpeg',
      AVATAR_JPEG_QUALITY,
    );
  });
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}
