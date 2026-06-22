Drawer from fiscalo. Use via `window.Fiscalo.Drawer` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface DrawerProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: number;
}
```
