import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Components
import RecommendComponent from './RecommendComponent';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/pagination';

// Page css
import './Recommend.style.css';

const Recommend = () => {
    const { id } = useParams();
    const [region, setRegion] = useState(null);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        setRegion(null); // id가 바뀌면 이전 데이터 초기화
        setLoading(true);

        // fetch(`http://localhost:3000/rankings/${id}`)
        fetch(`http://https://port-0-kortripfollow-mhg6zzrn5356f2c9.sel3.cloudtype.app/rankings/${id}`)
        .then(res => res.json())
        .then(data => {
            setRegion(data);
            setLoading(false);
        })
        .catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, [id]);
    
    if (loading) return <div>로딩중...</div>;
    if (!region) return <div>데이터가 없습니다.</div>;

  return (
    <div className='topRecommendCover'>
      <h1>갤러리</h1>
      {region.gallery && region.gallery.length > 0 && region.gallery[0] !== "" ? (
        <RecommendComponent item={region} />
      ) : (
      <div>갤러리가 비어있습니다..</div>
      )}
    </div>
  );
};

export default Recommend;
