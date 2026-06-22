Modal from fiscalo. Use via `window.Fiscalo.Modal` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface ModalProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  icon?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: number;
}
```
