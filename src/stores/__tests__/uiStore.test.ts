import { useUiStore } from '../uiStore';

describe('uiStore — Auto-play Previews highlight signal', () => {
  beforeEach(() => {
    useUiStore.setState({ pendingAutoPlayHighlight: false });
  });

  it('starts with no pending highlight', () => {
    expect(useUiStore.getState().pendingAutoPlayHighlight).toBe(false);
  });

  it('requestAutoPlayHighlight sets the pending flag', () => {
    useUiStore.getState().requestAutoPlayHighlight();
    expect(useUiStore.getState().pendingAutoPlayHighlight).toBe(true);
  });

  it('consumeAutoPlayHighlight clears the pending flag', () => {
    useUiStore.getState().requestAutoPlayHighlight();
    useUiStore.getState().consumeAutoPlayHighlight();
    expect(useUiStore.getState().pendingAutoPlayHighlight).toBe(false);
  });
});
