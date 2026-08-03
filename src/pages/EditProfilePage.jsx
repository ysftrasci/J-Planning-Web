import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Camera, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { auth } from '../services/firebase.js';
import { updateDisplayName } from '../services/emailAuth.js';
import { updateUserProfile } from '../db/userProfileRepository.js';
import { processProfilePhoto, validatePhotoFile } from '../services/photoUploadService.js';
import AppButton from '../components/AppButton.jsx';
import './EditProfilePage.css';

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const fileInputRef = useRef(null);

  const [name, setName] = useState(user?.profile?.displayName || user?.displayName || '');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUri, setPreviewUri] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const currentPhoto = previewUri || user?.profile?.photoURL || user?.photoURL;

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validatePhotoFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setErrorMessage('');
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUri(objectUrl);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setErrorMessage('Lütfen bir isim girin.');
      return;
    }

    setSaving(true);
    setErrorMessage('');
    try {
      const updates = {};

      if (name.trim() !== (user?.profile?.displayName || user?.displayName)) {
        await updateDisplayName(auth.currentUser, name.trim());
        updates.displayName = name.trim();
      }

      if (selectedFile) {
        const photoDataUri = await processProfilePhoto(selectedFile);
        updates.photoURL = photoDataUri;
      }

      if (Object.keys(updates).length > 0) {
        await updateUserProfile(user.uid, updates);
      }

      await refreshProfile();
      navigate('/profile');
    } catch (e) {
      setErrorMessage(e.message || 'Profil güncellenirken bir sorun oluştu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="edit-profile-page">
      <button
        type="button"
        className="edit-profile-page__back"
        onClick={() => navigate('/profile')}
      >
        <ChevronLeft size={18} />
        Profil
      </button>

      <h1>Profili Düzenle</h1>

      {errorMessage && <p className="edit-profile-page__error">{errorMessage}</p>}

      <div className="edit-profile-page__content">
        <input
          type="file"
          ref={fileInputRef}
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <button
          type="button"
          className="edit-profile-page__avatar-wrap"
          onClick={handlePhotoClick}
          title="Fotoğrafı değiştir"
        >
          {currentPhoto ? (
            <img src={currentPhoto} alt="" className="edit-profile-page__avatar-img" />
          ) : (
            <div className="edit-profile-page__avatar-placeholder">
              <User size={44} color="var(--color-accent-dark)" />
            </div>
          )}
          <div className="edit-profile-page__camera-badge">
            <Camera size={16} color="#FFF" />
          </div>
        </button>
        <span className="edit-profile-page__photo-hint">Fotoğrafı değiştirmek için dokun</span>

        <div className="edit-profile-page__form">
          <label className="edit-profile-page__label">Adın</label>
          <input
            type="text"
            className="edit-profile-page__input"
            placeholder="Adın"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <div className="edit-profile-page__footer">
        <AppButton
          title="Kaydet"
          onClick={handleSave}
          loading={saving}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}
