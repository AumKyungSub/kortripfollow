import React, {useEffect, useState} from 'react'
import { useParams } from 'react-router-dom'

// Components
import Header from '../Header/Header'
import Footer from '../footer/Footer'
import MainImage from './components/mainImage/MainImage'
import Explain from './components/explain/Explain'
import Parking from './components/parking/Parking'
import Recommend from './components/recommend/Recommend'

// Page CSS
import './Location.style.css'

const Location = () => {
    const { id } = useParams();
    const [ranking, setRanking] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);

    const getRankingDetail = async () => {
        setLoading(true);
        try {
            // const url = `http://localhost:3000/rankings/${id}`;
            const url = `http://https://port-0-kortripfollow-mhg6zzrn5356f2c9.sel3.cloudtype.app/rankings/${id}`;
            const response = await fetch(url);
            const data = await response.json();
            setRanking(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };
    
    useEffect(() => {
        getRankingDetail();
    }, [id]); // id변경 시 fetch
    
    // 화면 크기 변경 시 모바일 여부 감지
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 480);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    if (loading) return <div>로딩중...</div>;
    if (!ranking) return <div>데이터가 없습니다.</div>;

    return (
        <div>
            {!isMobile && <Header/>}
            {ranking && <MainImage item={ranking} />}
            {ranking && <Explain item={ranking} />}
            {ranking && <Parking item={ranking} />}
            {ranking && <Recommend item={ranking} />}
            <Footer/>
        </div>
    )
}

export default Location
