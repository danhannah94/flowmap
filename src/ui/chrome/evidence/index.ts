// Evidence and styles (UI24–UI27): importing this registers the inspector and styles side panels and the
// orphan-delete buttons in the error banner. The `styles-toggle` command lives in Styles.tsx and is listed by
// commands/diagram.ts.
import '../Inspector';
import '../Styles';
import '../Orphans';
import './BlockSize'; // v1.1 UI34: the block's size in the inspector (after the inspector, which it extends)
