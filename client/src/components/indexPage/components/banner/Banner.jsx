import React, {useEffect, useState} from 'react'

// Components
import BannerComponent from './BannerComponent';

// Swiper import
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination, Autoplay } from "swiper/modules";

// react-responsive import (hook)
import { useResponsive } from '../../../../hooks/ResponsiveUsed';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/navigation';

// Page CSS
import './Banner.style.css'


const Banner = () => {
    
    const {isMobile} = useResponsive();
    // 슬라이드 수 설정
    const slidesView = isMobile ? 1 : 1.6;
    
    const [rankingList, setRankingList] = useState([]);

    const getRanking =async()=>{
      // let url = `http://localhost:3000/rankings`;
      let url = `http://https://port-0-kortripfollow-mhg6zzrn5356f2c9.sel3.cloudtype.app/rankings`;
      let response = await fetch(url);
      let data = await response.json();

      // 전체 데이터 섞기 (랜덤 순서)
      const shuffled = [...data].sort(() => Math.random() - 0.5);

      // 랜덤으로 5개 추출
      const topFive = shuffled.slice(0, 5);
      
      // console.log(topFive);
      setRankingList(topFive);
    }

    useEffect(()=>{
      getRanking()
    },[])

  return (
    <div>
        <Swiper
            spaceBetween={30}
            slidesPerView={slidesView}
            centeredSlides={true}
            loop={true}
            autoplay={{
                delay: 2500,
                disableOnInteraction: false,
            }}
            pagination={{
                el: ".paging2",
                type: "progressbar",
            }}
            navigation={false}
            modules={[Autoplay, Pagination]}
            className="mySwiper"
        >            
          {rankingList.map((menu)=>(
            <SwiperSlide className="swiper-slide">
                <BannerComponent item={menu}/>
            </SwiperSlide>
          ))}
          <div className="play_bar_pc_cover">
            <div className="play_bar_pc">
                <div className="progress_spot_cover">
                    <div className="paging2"></div>
                </div>
            </div>
          </div>
        </Swiper>      
    </div>
    )
}

export default Banner
