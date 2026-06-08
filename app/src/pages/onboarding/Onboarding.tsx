import { Navigate, Route, Routes } from 'react-router-dom';

import OnboardingLayout from './OnboardingLayout';
import CustomActivityPage from './pages/CustomActivityPage';
import CustomEmbeddingsPage from './pages/CustomEmbeddingsPage';
import CustomInferencePage from './pages/CustomInferencePage';
import CustomOAuthPage from './pages/CustomOAuthPage';
import CustomSearchPage from './pages/CustomSearchPage';
import CustomVoicePage from './pages/CustomVoicePage';
import RuntimeChoicePage from './pages/RuntimeChoicePage';
import VaultSetupStep from './pages/VaultSetupStep';
import WelcomePage from './pages/WelcomePage';

/**
 * Onboarding flow for Gigi.
 *
 * New users land at /setup (GigiSetup wizard) first.
 * This legacy flow is kept for settings-level re-configuration.
 *
 *   welcome → runtime-choice
 *     ├── cloud  → /home
 *     └── custom → /custom/inference → voice → oauth → search → embeddings → vault → /home
 */
const Onboarding = () => {
  return (
    <Routes>
      <Route element={<OnboardingLayout />}>
        {/* Redirect /onboarding root to the Gigi first-run wizard */}
        <Route index element={<Navigate to="/setup" replace />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="runtime-choice" element={<RuntimeChoicePage />} />
        <Route path="custom/inference" element={<CustomInferencePage />} />
        <Route path="custom/voice" element={<CustomVoicePage />} />
        <Route path="custom/oauth" element={<CustomOAuthPage />} />
        <Route path="custom/search" element={<CustomSearchPage />} />
        <Route path="custom/embeddings" element={<CustomEmbeddingsPage />} />
        <Route path="custom/activity" element={<CustomActivityPage />} />
        <Route path="custom/vault" element={<VaultSetupStep />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Route>
    </Routes>
  );
};

export default Onboarding;
