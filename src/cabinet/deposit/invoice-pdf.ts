import type { Invoice } from './forms-model.ts'
const encode = (s: string) => new TextEncoder().encode(s)
// Image-backed PDF keeps Unicode bank labels intact without third-party fonts/services.
export function pdfFromJpegs(
  images: { bytes: Uint8Array; width: number; height: number }[],
): Uint8Array {
  const chunks: Uint8Array[] = [encode('%PDF-1.4\n')],
    offsets = [0]
  let length = chunks[0].length
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, body: Uint8Array) => {
    offsets[id] = length
    push(encode(id + ' 0 obj\n'))
    push(body)
    push(encode('\nendobj\n'))
  }
  object(1, encode('<< /Type /Catalog /Pages 2 0 R >>'))
  object(
    2,
    encode(
      '<< /Type /Pages /Count ' +
        images.length +
        ' /Kids [' +
        images.map((_, i) => 3 + i * 3 + ' 0 R').join(' ') +
        '] >>',
    ),
  )
  images.forEach((image, i) => {
    const id = 3 + i * 3,
      commands = encode('q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n')
    object(
      id,
      encode(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ' +
          (id + 2) +
          ' 0 R >> >> /Contents ' +
          (id + 1) +
          ' 0 R >>',
      ),
    )
    object(
      id + 1,
      encode(
        '<< /Length ' +
          commands.length +
          ' >>\nstream\n' +
          new TextDecoder().decode(commands) +
          'endstream',
      ),
    )
    const header = encode(
        '<< /Type /XObject /Subtype /Image /Width ' +
          image.width +
          ' /Height ' +
          image.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
          image.bytes.length +
          ' >>\nstream\n',
      ),
      tail = encode('\nendstream')
    const body = new Uint8Array(
      header.length + image.bytes.length + tail.length,
    )
    body.set(header)
    body.set(image.bytes, header.length)
    body.set(tail, header.length + image.bytes.length)
    object(id + 2, body)
  })
  const xref = length
  push(
    encode(
      'xref\n0 ' +
        offsets.length +
        '\n0000000000 65535 f \n' +
        offsets
          .slice(1)
          .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
          .join('') +
        'trailer\n<< /Size ' +
        offsets.length +
        ' /Root 1 0 R >>\nstartxref\n' +
        xref +
        '\n%%EOF\n',
    ),
  )
  const result = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    result.set(chunk, at)
    at += chunk.length
  }
  return result
}
export async function downloadInvoice(invoice: Invoice, accountLabel: string) {
  await document.fonts.ready
  const width = 1240,
    height = 1754,
    margin = 90,
    lineHeight = 34,
    images: { bytes: Uint8Array; width: number; height: number }[] = []
  let canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d')!,
    y = margin
  function start() {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#111'
    ctx.font = '24px Inter, sans-serif'
    y = margin
  }
  function finish() {
    const raw = atob(canvas.toDataURL('image/jpeg', 0.94).split(',')[1])
    images.push({
      bytes: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      width,
      height,
    })
  }
  function line(value: string) {
    let current = ''
    for (const ch of value) {
      if (
        ch === '\n' ||
        ctx.measureText(current + ch).width > width - margin * 2
      ) {
        if (y > height - margin) {
          finish()
          start()
        }
        ctx.fillText(current, margin, y)
        y += lineHeight
        current = ch === '\n' ? '' : ch
      } else current += ch
    }
    if (y > height - margin) {
      finish()
      start()
    }
    ctx.fillText(current, margin, y)
    y += lineHeight
  }
  start()
  line('Инвойс ' + invoice.number)
  line(invoice.date)
  y += 20
  line('Сумма: ' + invoice.amount + ' ' + invoice.currency)
  line('На счёт: ' + accountLabel)
  y += 20
  for (const pair of invoice.header) line(pair.key + ': ' + pair.value)
  for (const group of invoice.groups) {
    y += 20
    for (const pair of group) line(pair.key + ': ' + pair.value)
  }
  finish()
  const bytes = pdfFromJpegs(images),
    url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }),
    ),
    link = document.createElement('a')
  link.href = url
  link.download = 'invoice.pdf'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
