import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface PairingQRCodeProps {
  value: string;
  size?: number;
}

export const PairingQRCode: React.FC<PairingQRCodeProps> = ({ value, size = 216 }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#101827',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-2xl bg-white/95 text-xs font-medium text-slate-600"
      >
        Generating QR…
      </div>
    );
  }

  return (
    <div className="inline-block rounded-2xl bg-white p-3 shadow-lg">
      <img
        src={dataUrl}
        alt="Scan with your phone to connect as a wireless mouse"
        width={size}
        height={size}
        draggable={false}
        referrerPolicy="no-referrer"
        className="block rounded-lg"
      />
    </div>
  );
};
